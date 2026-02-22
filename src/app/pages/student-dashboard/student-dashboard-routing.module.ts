import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { StudentDashboardPage } from './student-dashboard.page';

const routes: Routes = [
  {
    path: '',
    component: StudentDashboardPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class StudentDashboardPageRoutingModule { }
