import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Injectable({
  providedIn: 'root'
})
export class AdminGuard implements CanActivate {
  constructor(private authService: AuthService, private router: Router) {}

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): boolean {
    if (this.authService.isAuthenticated() && this.authService.isAdmin()) {
      return true;
    }

    // Redirect to appropriate page if not admin
    if (this.authService.isAuthenticated()) {
      this.router.navigate(['/teacher-dashboard']);
    } else {
      this.router.navigate(['/login']);
    }
    return false;
  }
}
