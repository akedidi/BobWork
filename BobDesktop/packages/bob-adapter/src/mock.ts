import type { BobEvent } from '@bob-work/shared-types';

export class MockBobAdapter {
  async sendMessage(prompt: string, projectId?: string): Promise<string> {
    console.log(`Mocking Bob message: ${prompt}`);
    return `This is a mock response from Bob for prompt: ${prompt}`;
  }

  simulateEvent(event: BobEvent) {
    console.log('Simulating event:', event);
  }
}
