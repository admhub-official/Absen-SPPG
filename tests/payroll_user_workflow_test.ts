const read = (path: string) => Deno.readTextFile(path);

Deno.test("My Payroll uses the canonical recipient-signature workflow", async () => {
  const endpoint = await read("supabase/functions/PayrollUser/index.ts");
  const workflow = await read("supabase/functions/Absen/payroll-signature-workflow.ts");
  const frontend = await read("supabase-config.js");

  if (!endpoint.includes("handlePayrollSignatureWorkflow")) {
    throw new Error("PayrollUser must invoke the canonical payroll signature workflow");
  }
  for (const functionName of [
    "prosesPayroll",
    "getMyPayroll",
    "getSlipDownloadUrl",
    "signPayrollReceipt",
  ]) {
    if (!workflow.includes(`\"${functionName}\"`)) {
      throw new Error(`payroll workflow missing ${functionName}`);
    }
    if (!frontend.includes(`'${functionName}'`)) {
      throw new Error(`frontend does not route ${functionName} to PayrollUser`);
    }
  }
  if (!workflow.includes('.in("Status_Penerbitan", ["MENUNGGU_TTD_PENERIMA", "DITERBITKAN"])')) {
    throw new Error("getMyPayroll must include pending recipient-signature and published slips");
  }
  if (!workflow.includes('perluTandaTangan: slip.Status_Penerbitan === "MENUNGGU_TTD_PENERIMA"')) {
    throw new Error("pending slips must be marked as requiring recipient signature");
  }
  if (!workflow.includes('dapatDiunduh: slip.Status_Penerbitan === "DITERBITKAN"')) {
    throw new Error("only finalized slips may be downloadable");
  }
  if (!workflow.includes('.eq("ID_User", session.idUser)')) {
    throw new Error("My Payroll must remain scoped to the authenticated user");
  }
});
