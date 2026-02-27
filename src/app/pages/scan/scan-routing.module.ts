import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { ScanPage } from './scan.page'; // Re-triggering linter scan

const routes: Routes = [
  {
    path: '',
    component: ScanPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ScanPageRoutingModule {}
