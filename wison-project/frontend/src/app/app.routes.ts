import { Routes } from '@angular/router';
import { Editor } from './pages/editor/editor';
import { Tester } from './pages/tester/tester';

export const routes: Routes = [
  { path: '',        redirectTo: 'editor', pathMatch: 'full' },
  { path: 'editor',  component: Editor  },
  { path: 'tester',  component: Tester  },
  { path: '**',      redirectTo: 'editor' }
];