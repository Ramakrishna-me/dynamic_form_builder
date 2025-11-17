import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { App } from './app';

@NgModule({
  declarations: [App],
  imports: [BrowserModule, ReactiveFormsModule, FormsModule, HttpClientModule, DragDropModule],
  providers: [],
  bootstrap: [App],
})
export class AppModule {}
