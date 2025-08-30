import { Component } from '@angular/core';
import { NavController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { LocalDataService } from '../../services/local-data.service';

@Component({
  selector: 'app-class-list',
  templateUrl: './class-list.page.html',
  styleUrls: ['./class-list.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
})
export class ClassListPage {

 className = '';
  classes = LocalDataService.getClasses();

  constructor(private navCtrl: NavController) {}

  addClass() {
    if (this.className.trim()) {
      LocalDataService.addClass(this.className);
      this.className = '';
    }
  }

  goToSubjects(classId: number) {
    this.navCtrl.navigateForward(`/subject-list/${classId}`);
  }

  deleteClass(classId: number) {
    if (confirm('Are you sure you want to delete this class?')) {
      LocalDataService.deleteClass(classId);
      this.classes = LocalDataService.getClasses(); // refresh list
    }
  }
}