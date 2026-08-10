import { Injectable } from '@nestjs/common';

/**
 * Clock abstraction service for system time retrieval.
 * Provides a clean interface for deterministic testing of reservation expiration logic.
 */
@Injectable()
export class ClockService {
  private customDate: Date | null = null;

  /**
   * Returns current Date (or fixed custom Date if overridden for testing).
   */
  now(): Date {
    return this.customDate ? new Date(this.customDate.getTime()) : new Date();
  }

  /**
   * Override system clock date for deterministic tests.
   */
  setSystemTime(date: Date | null): void {
    this.customDate = date ? new Date(date.getTime()) : null;
  }

  /**
   * Reset overridden clock back to real system clock.
   */
  resetSystemTime(): void {
    this.customDate = null;
  }
}
