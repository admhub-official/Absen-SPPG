import { apiClient } from './api-client.js';

const sessionToken = () => window.HadirlySessionContext?.token?.() || '';
const withToken = (payload = {}) => {
  const token = sessionToken();
  return token && payload.token === undefined ? { ...payload, token } : payload;
};
const call = (name) => (payload = {}) => apiClient.call(name, withToken(payload));

const getMyAbsensi = call('getMyAbsensi');
export const attendanceService = Object.freeze({
  mine: getMyAbsensi,
  record: call('recordAbsensiSelf'),
  summary: async (payload = {}) => {
    const result = await getMyAbsensi(payload);
    return {
      totalHariKerja: Number(result?.totalHariKerja || 0),
      totalDatang: Number(result?.totalDatang || 0),
      totalPulang: Number(result?.totalPulang || 0),
    };
  },
});

export const userService = Object.freeze({
  profile: call('getProfilLengkap'),
  updateProfile: call('updateProfil'),
  changePassword: call('changePassword'),
  refreshFace: call('updateFaceDescriptor'),
});

export const deviceService = Object.freeze({
  list: () => window.getMyAttendanceDevices?.() || [],
  revoke: (deviceId) => window.revokeMyAttendanceDevice?.(deviceId),
  queue: (status = 'PENDING') => window.getAttendanceDeviceReviewQueue?.(status),
  review: (deviceId, status, reason) => window.reviewAttendanceDevice?.(deviceId, status, reason),
});

const listComplaints = call('getRiwayatPengaduanSaya');
export const complaintService = Object.freeze({
  list: listComplaints,
  create: call('kirimPengaduan'),
  detail: async (idPengaduan) => {
    const result = await listComplaints();
    return (result?.pengaduan || []).find((row) => String(row.ID_Pengaduan) === String(idPengaduan)) || null;
  },
  reply: call('simpanTanggapanAdmin'),
  markRead: call('tandaiSudahDibaca'),
});

async function listPayrollSlips({ status = 'DITERBITKAN', page = 1, pageSize = 30 } = {}) {
  const response = await fetch('https://szwwpnbbsmjsbzzcecyj.supabase.co/functions/v1/PayrollListPage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: sessionToken(), status, page, pageSize }),
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({ success: false, error: 'Respons daftar payroll tidak valid.' }));
  if (!response.ok || payload?.success === false) throw new Error(payload?.error || payload?.message || 'Gagal mengambil daftar slip payroll.');
  return payload?.result || { items: [], total: 0, page, pageSize, totalPages: 0 };
}

const getMyPayroll = call('getMyPayroll');
export const payrollService = Object.freeze({
  history: getMyPayroll,
  list: listPayrollSlips,
  detail: async (idSlip) => {
    const result = await getMyPayroll();
    return (result?.payroll || []).find((row) => String(row.idSlip || row.ID_Slip) === String(idSlip)) || null;
  },
  issue: call('prosesPayroll'),
  sign: call('signPayrollReceipt'),
  download: call('getSlipDownloadUrl'),
});
