import {createProfilePage} from '../pages/profile/profile-page.js';
import {createDevicePage} from '../pages/devices/device-page.js';
import {createComplaintPage} from '../pages/complaints/complaint-page.js';
import {createPayrollPage} from '../pages/payroll/payroll-page.js';
export function createFeatureRegistry(){const factories=new Map([['profile',createProfilePage],['devices',createDevicePage],['complaints',createComplaintPage],['payroll',createPayrollPage]]);return Object.freeze({has:(name)=>factories.has(name),mount(name,options){const factory=factories.get(name);if(!factory)throw new Error(`Feature ${name} belum terdaftar.`);return factory(options);},names:()=>[...factories.keys()]});}