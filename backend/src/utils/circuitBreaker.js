/**
 * Lightweight circuit breaker — no external deps.
 * States: CLOSED (normal) → OPEN (failing) → HALF_OPEN (testing)
 */
export class CircuitBreaker {
  constructor(fn, options = {}) {
    this.fn = fn;
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeoutMs = options.resetTimeoutMs || 30000;
    this.state = 'CLOSED';
    this.failures = 0;
    this.lastFailure = null;
    this.name = options.name || 'circuit';
  }

  async fire(...args) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailure > this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error(`Circuit breaker [${this.name}] is OPEN`);
      }
    }

    try {
      const result = await this.fn(...args);
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  onFailure() {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  getState() {
    return { state: this.state, failures: this.failures, name: this.name };
  }
}
