import { TestBed } from '@angular/core/testing';

import { Wison } from './wison';

describe('Wison', () => {
  let service: Wison;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Wison);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
