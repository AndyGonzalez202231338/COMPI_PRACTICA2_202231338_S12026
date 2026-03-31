import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Tester } from './tester';

describe('Tester', () => {
  let component: Tester;
  let fixture: ComponentFixture<Tester>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Tester]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Tester);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
