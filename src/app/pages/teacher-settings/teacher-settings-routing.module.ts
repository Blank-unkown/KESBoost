import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { TeacherSettingsPage } from './teacher-settings.page';

const routes: Routes = [
  {
    path: '',
    component: TeacherSettingsPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class TeacherSettingsPageRoutingModule { }
