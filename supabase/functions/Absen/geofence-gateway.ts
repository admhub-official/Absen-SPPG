// Compatibility entrypoint for the public Absen Edge Function.
// Location validation and self-attendance now use AttendanceLocation,
// whose latitude, longitude, radius, active state, and fallback are read
// from the Lokasi_SPPG backend configured by SUPER ADMIN.
import './proxy.ts';
