import { TestBed } from '@angular/core/testing';

import { Analyzer } from './analyzer';

describe('Analyzer', () => {
  let service: Analyzer;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Analyzer);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
