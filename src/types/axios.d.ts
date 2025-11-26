// Fix for axios default export with NodeNext module resolution
// 
// Problem: Axios 0.27.2 doesn't have an "exports" field in package.json,
// which causes TypeScript's NodeNext module resolution to fail when resolving
// the default export. TypeScript treats `import axios from 'axios'` as a namespace
// import instead of recognizing it as a default export with methods like .get() and .post().
//
// Solution: This module augmentation ensures TypeScript recognizes the default export.
// We can't redeclare the module, but we can ensure the types are properly recognized
// by creating a type-only declaration that helps TypeScript understand the structure.

// The actual fix: ensure TypeScript recognizes that axios has a default export
// by referencing the types from the original axios module
import type { AxiosStatic } from 'axios';

// This tells TypeScript that when you import axios, you get an AxiosStatic instance
// which has methods like .get(), .post(), etc.
declare module 'axios' {
  // Re-export everything from axios
  export * from 'axios/index';
  
  // Ensure default export is recognized - this is the key fix
  const axiosDefault: AxiosStatic;
  export default axiosDefault;
}


