import { Component, HostBinding, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, FormControl } from '@angular/forms';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { HttpClient } from '@angular/common/http';
// import { saveAs } from 'file-saver'; // optional: explanation below

/* NOTE: file-saver is optional. If you don't want to install it,
   the code uses a vanilla anchor-download fallback too. */

type FieldType =
  | 'text'
  | 'number'
  | 'email'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'hidden'
  | 'date'
  | 'time'
  | 'password'
  | 'section';

interface DynamicField {
  id: string;
  type: FieldType;
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: string[]; // for select / radio
  group?: string | null; // section/group id or title
  meta?: {
    min?: number | null;
    max?: number | null;
    pattern?: string | null;
    multiple?: boolean;
  };
  conditional?: ConditionalRule | null;
  value?: any;
}

interface ConditionalRule {
  fieldId: string; // source field to watch
  operator: 'equals' | 'not_equals' | 'contains' | 'gt' | 'lt';
  value: string;
  action: 'show' | 'hide';
}

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrls: ['./app.scss'],
  standalone: false,
})
export class App implements OnInit {
  // theme toggle helper
  @HostBinding('class.dark-theme') darkTheme = false;

  // forms
  builderForm!: FormGroup;
  importForm!: FormGroup; // for schema import & webhook
  dynamicForm!: FormGroup;

  // schema and UI state
  fields: DynamicField[] = [];
  groups: { id: string; title: string }[] = [];
  selectedFieldIndex: number | null = null;

  // preview & UI helpers
  previewValues: Record<string, any> = {};
  autosaveKey = 'dyn-form-schema-v1';

  constructor(private fb: FormBuilder, private http: HttpClient) {
    // initialize builder form in constructor (fb available)
    this.builderForm = this.fb.group({
      type: ['text'],
      label: [''],
      placeholder: [''],
      required: [false],
      options: [''],
      group: [''],
      min: [''],
      max: [''],
      pattern: [''],
      multiple: [false],
    });

    this.importForm = this.fb.group({
      importJson: [''],
      webhookUrl: [''],
    });

    this.dynamicForm = this.fb.group({});
  }

  ngOnInit() {
    // attempt restore from localStorage
    const saved = localStorage.getItem(this.autosaveKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { fields: DynamicField[]; groups: any[] };
        if (Array.isArray(parsed.fields)) {
          this.fields = parsed.fields;
          this.groups = parsed.groups || [];
          // rebuild form controls
          this.fields.forEach((f) => this.addControlForField(f, false));
        }
      } catch (e) {
        console.warn('Could not parse saved schema', e);
      }
    }

    // if nothing exists, seed a friendly field
    if (!this.fields.length) {
      this.addField({
        id: this.genId(),
        type: 'email',
        label: 'Mail',
        placeholder: 'you@example.com',
        required: true,
      });
    }

    // listen for dynamic form changes for conditional evaluation and autosave
    this.dynamicForm.valueChanges.subscribe(() => {
      this.evaluateConditions();
      this.saveSchema();
    });
  }

  // --- ID generator ---
  genId(prefix = 'f') {
    return prefix + Math.random().toString(36).slice(2, 9);
  }

  getCtrl(form: FormGroup, name: string): FormControl {
    return form.get(name) as FormControl;
  }

  // --- SCHEMA MANAGEMENT ---
  addField(from?: Partial<DynamicField>) {
    const field: DynamicField = {
      id: from?.id ?? this.genId(),
      type: (from?.type ?? this.builderForm.get('type')!.value) as FieldType,
      label: from?.label ?? (this.builderForm.get('label')!.value || 'Untitled'),
      placeholder: from?.placeholder ?? this.builderForm.get('placeholder')!.value,
      required: from?.required ?? this.builderForm.get('required')!.value,
      options:
        from?.options ??
        (this.builderForm.get('options')!.value
          ? (this.builderForm.get('options')!.value as string)
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : []),
      group: from?.group ?? (this.builderForm.get('group')!.value || null),
      meta: {
        min: this.builderForm.get('min')!.value ? Number(this.builderForm.get('min')!.value) : null,
        max: this.builderForm.get('max')!.value ? Number(this.builderForm.get('max')!.value) : null,
        pattern: this.builderForm.get('pattern')!.value || null,
        multiple: this.builderForm.get('multiple')!.value || false,
      },
      conditional: from?.conditional ?? null,
      value: from?.value ?? '',
    };

    this.fields.push(field);
    this.addControlForField(field, true);
    this.builderForm.patchValue({
      label: '',
      placeholder: '',
      required: false,
      options: '',
      group: '',
      min: '',
      max: '',
      pattern: '',
      multiple: false,
    });
    this.saveSchema();
  }

  addGroup(title?: string) {
    const id = this.genId('g');
    this.groups.push({ id, title: title ?? `Section ${this.groups.length + 1}` });
    this.saveSchema();
  }

  duplicateField(index: number) {
    const orig = this.fields[index];
    const copy: DynamicField = JSON.parse(JSON.stringify(orig));
    copy.id = this.genId();
    copy.label = orig.label + ' (copy)';
    this.fields.splice(index + 1, 0, copy);
    this.addControlForField(copy, true);
    this.saveSchema();
  }

  removeField(index: number) {
    const f = this.fields[index];
    if (this.dynamicForm.contains(f.id)) this.dynamicForm.removeControl(f.id);
    this.fields.splice(index, 1);
    if (this.selectedFieldIndex === index) this.selectedFieldIndex = null;
    this.saveSchema();
  }

  editField(index: number) {
    this.selectedFieldIndex = index;
    const f = this.fields[index];
    this.builderForm.patchValue({
      type: f.type,
      label: f.label,
      placeholder: f.placeholder ?? '',
      required: !!f.required,
      options: (f.options && f.options.join(', ')) || '',
      group: f.group ?? '',
      min: f.meta?.min ?? '',
      max: f.meta?.max ?? '',
      pattern: f.meta?.pattern ?? '',
      multiple: !!f.meta?.multiple,
    });
  }

  updateField() {
    if (this.selectedFieldIndex == null) return;
    const idx = this.selectedFieldIndex;
    const f = this.fields[idx];

    const newType = this.builderForm.get('type')!.value as FieldType;
    const newOptions = (this.builderForm.get('options')!.value as string)
      ? (this.builderForm.get('options')!.value as string)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    f.type = newType;
    f.label = this.builderForm.get('label')!.value || f.label;
    f.placeholder = this.builderForm.get('placeholder')!.value;
    f.required = this.builderForm.get('required')!.value;
    f.options = newOptions;
    f.group = this.builderForm.get('group')!.value || null;
    f.meta = {
      min: this.builderForm.get('min')!.value ? Number(this.builderForm.get('min')!.value) : null,
      max: this.builderForm.get('max')!.value ? Number(this.builderForm.get('max')!.value) : null,
      pattern: this.builderForm.get('pattern')!.value || null,
      multiple: this.builderForm.get('multiple')!.value || false,
    };

    // update control validators
    const ctrl = this.dynamicForm.get(f.id);
    if (ctrl) {
      const validators: any[] = [];
      if (f.required) validators.push(Validators.required);
      if (f.meta?.min != null && (f.type === 'number' || f.type === 'date'))
        validators.push(Validators.min(f.meta!.min as number));
      if (f.meta?.max != null && (f.type === 'number' || f.type === 'date'))
        validators.push(Validators.max(f.meta!.max as number));
      if (f.meta?.pattern) validators.push(Validators.pattern(new RegExp(f.meta.pattern)));
      ctrl.setValidators(validators);
      ctrl.updateValueAndValidity();
    }

    this.selectedFieldIndex = null;
    this.builderForm.patchValue({
      label: '',
      placeholder: '',
      required: false,
      options: '',
      group: '',
      min: '',
      max: '',
      pattern: '',
      multiple: false,
    });
    this.saveSchema();
  }

  moveUp(i: number) {
    if (i === 0) return;
    [this.fields[i - 1], this.fields[i]] = [this.fields[i], this.fields[i - 1]];
    this.saveSchema();
  }

  moveDown(i: number) {
    if (i === this.fields.length - 1) return;
    [this.fields[i + 1], this.fields[i]] = [this.fields[i], this.fields[i + 1]];
    this.saveSchema();
  }

  // --- drag & drop ---
  drop(event: CdkDragDrop<DynamicField[]>) {
    moveItemInArray(this.fields, event.previousIndex, event.currentIndex);
    this.saveSchema();
  }

  // --- reactive control management ---
  addControlForField(field: DynamicField, setDefault = true) {
    const validators: any[] = [];
    if (field.required) validators.push(Validators.required);
    if (field.meta?.min != null && (field.type === 'number' || field.type === 'date'))
      validators.push(Validators.min(field.meta!.min as number));
    if (field.meta?.max != null && (field.type === 'number' || field.type === 'date'))
      validators.push(Validators.max(field.meta!.max as number));
    if (field.meta?.pattern) {
      try {
        validators.push(Validators.pattern(new RegExp(field.meta.pattern!)));
      } catch (e) {
        console.warn('Invalid pattern for field', field.id, e);
      }
    }

    const initial = setDefault
      ? field.value ?? (field.type === 'checkbox' ? false : '')
      : field.value ?? '';
    const control =
      field.type === 'checkbox'
        ? new FormControl(Boolean(initial), validators)
        : new FormControl(initial, validators);

    this.dynamicForm.addControl(field.id, control);

    // reflect preview values and listen for changes
    this.previewValues[field.id] = initial;
    this.dynamicForm.get(field.id)!.valueChanges.subscribe((v) => {
      this.previewValues[field.id] = v;
      this.evaluateConditions();
    });
  }

  // --- conditional rules ---
  setConditionalForField(index: number, rule: ConditionalRule | null) {
    this.fields[index].conditional = rule;
    this.saveSchema();
    this.evaluateConditions();
  }

  evaluateConditions() {
    // For each field with conditional rule, determine visibility
    this.fields.forEach((f) => {
      if (!f.conditional) {
        // ensure control exists and enabled
        if (this.dynamicForm.get(f.id)?.disabled)
          this.dynamicForm.get(f.id)!.enable({ emitEvent: false });
        return;
      }
      const rule = f.conditional!;
      const sourceVal = this.previewValues[rule.fieldId];
      let match = false;
      switch (rule.operator) {
        case 'equals':
          match = String(sourceVal) === rule.value;
          break;
        case 'not_equals':
          match = String(sourceVal) !== rule.value;
          break;
        case 'contains':
          match = String(sourceVal || '').includes(rule.value);
          break;
        case 'gt':
          match = Number(sourceVal) > Number(rule.value);
          break;
        case 'lt':
          match = Number(sourceVal) < Number(rule.value);
          break;
      }

      if (rule.action === 'show') {
        if (!match) {
          // hide: disable control so validation won't block submit
          this.dynamicForm.get(f.id)?.disable({ emitEvent: false });
        } else {
          this.dynamicForm.get(f.id)?.enable({ emitEvent: false });
        }
      } else {
        // hide action
        if (match) this.dynamicForm.get(f.id)?.disable({ emitEvent: false });
        else this.dynamicForm.get(f.id)?.enable({ emitEvent: false });
      }
    });
  }

  // --- export / import JSON schema ---
  exportSchema() {
    const payload = { fields: this.fields, groups: this.groups };
    const text = JSON.stringify(payload, null, 2);

    // try to use file-saver if present; otherwise fallback to anchor download
    try {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'form-schema.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Could not download schema', e);
    }
  }

  importSchemaFromText(jsonText: string) {
    try {
      const parsed = JSON.parse(jsonText) as { fields: DynamicField[]; groups?: any[] };
      if (!Array.isArray(parsed.fields)) throw new Error('Invalid schema');
      // clear current
      this.fields = parsed.fields;
      this.groups = parsed.groups || [];
      // rebuild form
      // remove old controls
      Object.keys(this.dynamicForm.controls).forEach((k) => this.dynamicForm.removeControl(k));
      this.fields.forEach((f) => this.addControlForField(f, true));
      this.saveSchema();
    } catch (e) {
      alert('Import failed: ' + (e as Error).message);
    }
  }

  handleJsonFileInput(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      this.importSchemaFromText(text);
    };
    reader.readAsText(file);
  }

  // --- localStorage autosave ---
  saveSchema() {
    try {
      const text = JSON.stringify({ fields: this.fields, groups: this.groups });
      localStorage.setItem(this.autosaveKey, text);
    } catch (e) {
      console.warn('Could not save schema', e);
    }
  }

  // --- theme toggle ---
  toggleTheme() {
    this.darkTheme = !this.darkTheme;
  }

  // --- submit (webhook + local) ---
  async submit() {
    // mark touched
    Object.values(this.dynamicForm.controls).forEach((c) => c.markAsTouched());
    if (this.dynamicForm.invalid) {
      alert('Form invalid — please fix required fields.');
      return;
    }

    const payload = this.dynamicForm.getRawValue();
    // try webhook if provided
    const url = this.importForm.get('webhookUrl')!.value;
    if (url) {
      try {
        await this.http.post(url, payload).toPromise();
        alert('Submitted to webhook successfully.');
      } catch (e) {
        console.warn('Webhook failed', e);
        alert('Webhook submission failed — check console.');
      }
    } else {
      // otherwise just log or show
      console.log('Form submitted', payload);
      alert('Form submitted — check console.');
    }
  }

  // --- small helpers for template binding ---
  optionList(field: DynamicField) {
    return field.options ?? [];
  }

  addHiddenField() {
    this.addField({ type: 'hidden', label: 'hidden_field', placeholder: '', required: false });
  }

  addSection(title?: string) {
    const id = this.genId('s');
    const section: DynamicField = {
      id,
      type: 'section',
      label: title ?? `Section ${this.groups.length + 1}`,
      required: false,
      options: [],
      group: null,
      meta: {},
    };
    this.fields.push(section);
    // sections are visual only — no control added
    this.saveSchema();
  }
}
