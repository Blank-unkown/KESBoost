import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TeacherSettingsPageRoutingModule } from './teacher-settings-routing.module';
import { TeacherSettingsPage } from './teacher-settings.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    TeacherSettingsPageRoutingModule
  ],
  declarations: [TeacherSettingsPage]
})
export class TeacherSettingsPageModule { }
