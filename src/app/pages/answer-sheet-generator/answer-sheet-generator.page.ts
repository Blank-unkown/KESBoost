import { Component, OnInit, Input } from '@angular/core';
import { NavController, ToastController, LoadingController, IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LocalDataService, TopicEntry } from '../../services/local-data.service';
import { ActivatedRoute } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { FileOpener } from '@capacitor-community/file-opener';
import { Share } from '@capacitor/share';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

@Component({
  selector: 'app-answer-sheet-generator',
  templateUrl: './answer-sheet-generator.page.html',
  styleUrls: ['./answer-sheet-generator.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class AnswerSheetGeneratorPage implements OnInit {
  @Input() classId!: number;
  @Input() subjectId!: number;

  tos: TopicEntry[] = [];
  totalQuestions = 0;
  className = '';
  subjectName = '';
  pdfContent: string | null = null; // <-- add this

  constructor(
    private route: ActivatedRoute,
    private toastController: ToastController,
    private loadingController: LoadingController
  ) {}

  ngOnInit() {
    this.classId = Number(this.route.snapshot.paramMap.get('classId'));
    this.subjectId = Number(this.route.snapshot.paramMap.get('subjectId'));

    const cls = LocalDataService.getClass(this.classId);
    const subject = LocalDataService.getSubject(this.classId, this.subjectId);

    this.className = cls?.name || '';
    this.subjectName = subject?.name || '';
    this.tos = subject?.tos || [];
    this.totalQuestions = this.tos.reduce(
      (sum, topic) => sum + Number(topic.expectedItems || 0),
      0
    );
  }

  getX(index: number): number {
    const group = Math.floor(index / 10);
    const colWidth = 200;
    const col = group % 3;
    return 120 + col * colWidth;
  }

  getY(index: number): number {
    const group = Math.floor(index / 10);
    const row = index % 10;
    const rowHeight = 30; // tighter rows
    return group < 3 ? 185 + row * rowHeight : 505 + row * rowHeight;
  }
async exportPDF() {
  const element = document.getElementById('answer-sheet-container');
  if (!element) {
    alert('Answer sheet not found.');
    return;
  }

  const loading = await this.loadingController.create({
    message: 'Generating PDF...',
    spinner: 'dots',
  });
  await loading.present();

  try {
    // ✅ Clone the element so the preview isn't disturbed
    const clone = element.cloneNode(true) as HTMLElement;
    const rect = element.getBoundingClientRect();
    clone.style.width = rect.width + "px";
    clone.style.height = rect.height + "px";
    clone.style.position = "fixed";
    clone.style.left = "-10000px";
    clone.style.top = "-10000px";
    clone.style.paddingTop = "180px";
    clone.style.zIndex = "-1";
    document.body.appendChild(clone);

    // 📸 Render
    const canvas = await html2canvas(clone, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
    });

    document.body.removeChild(clone);

    // Convert canvas → PDF
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    const imgProps = pdf.getImageProperties(imgData);
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
    const x = 0;
    const y = (pdf.internal.pageSize.getHeight() - pdfHeight) / 2;

    pdf.addImage(imgData, "PNG", x, y, pdfWidth, pdfHeight);

    const fileName = `answer-sheet-${Date.now()}.pdf`;

if (Capacitor.getPlatform() !== 'web') {
  const pdfBase64 = pdf.output('datauristring').split(',')[1];
  try {
    // Step 1: Save file
    const savedFile = await Filesystem.writeFile({
      path: fileName,
      data: pdfBase64,
      directory: Directory.Documents,
    });

    this.showToast('✅ PDF saved!');

    // Step 2: Get sharable URI
    let shareUrl = '';
    if (Capacitor.getPlatform() === 'android') {
      // Android → need content:// URI
      const fileUri = await Filesystem.getUri({
        path: fileName,
        directory: Directory.Documents,
      });
      shareUrl = fileUri.uri; // content:// URI
    } else if (Capacitor.getPlatform() === 'ios') {
      // iOS → can use base64 data URI
      shareUrl = `data:application/pdf;base64,${pdfBase64}`;
    }

    // Step 3: Share file
    await Share.share({
      title: 'Generated Answer Sheet',
      text: 'Here is the generated answer sheet.',
      url: shareUrl,
      dialogTitle: 'Share PDF',
    });

    this.showToast('✅ PDF shared!');
  } catch (err) {
    console.error('PDF save/share failed:', err);
    this.showToast('⚠️ PDF saved, but sharing failed.');
  } finally {
    await loading.dismiss();
  } 
}

else {
  // 💻 Browser
  const blobUrl = pdf.output('bloburl').toString();
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  await loading.dismiss();
  window.open(blobUrl, '_blank');
  this.showToast('✅ PDF downloaded and opened!');
}

} catch (error) {
  console.error('Export error:', error);
  await loading.dismiss();
  this.showToast('❌ Failed to export or share PDF.');
}
}
private blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.readAsDataURL(blob);
  });
}

private async showToast(message: string) {
  const toast = await this.toastController.create({
    message,
    duration: 3000,
    position: 'bottom',
    color: 'dark',
  });
  await toast.present();
}

}