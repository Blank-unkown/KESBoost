import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { HttpClientModule } from '@angular/common/http';

import { ScanPageRoutingModule } from './scan-routing.module';
import { ScanPage } from './scan.page'; // Re-triggering linter scan

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    HttpClientModule,
    ScanPageRoutingModule,
    ScanPage
  ]
})
export class ScanPageModule {}
