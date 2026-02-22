import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { StudentDashboardPageRoutingModule } from './student-dashboard-routing.module';

import { StudentDashboardPage } from './student-dashboard.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    StudentDashboardPageRoutingModule
  ],
  declarations: [StudentDashboardPage]
})
export class StudentDashboardPageModule { }
