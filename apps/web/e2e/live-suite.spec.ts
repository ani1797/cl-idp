import { expect, test } from "@playwright/test";

import { cleanupProcess, createProcessViaUi, rowForFileName, seedFailedJob, uploadSample } from "./helpers";

test.describe.configure({ mode: "serial" });

let reusableReadyProcessId: string | null = null;

test.afterAll(async () => {
  if (reusableReadyProcessId) {
    cleanupProcess(reusableReadyProcessId);
    reusableReadyProcessId = null;
  }
});

test("happy path creates, uploads, reviews, and filters reviewed jobs", async ({ page, request }) => {
  const uploadedFileName = `invoice-happy-${Date.now()}.pdf`;

  const process = await createProcessViaUi(page, request, {
    processLabel: "Playwright happy path",
  });
  reusableReadyProcessId = process.processId;

  await uploadSample(page, "invoice.pdf", uploadedFileName);
  await expect(page).toHaveURL(new RegExp(`/processes/${reusableReadyProcessId}/jobs/[^/?]+`), {
    timeout: 5 * 60 * 1000,
  });

  const approveButton = page.getByRole("button", { name: "Approve" }).first();
  await expect(approveButton).toBeVisible();
  await approveButton.click();

  const fieldInputs = page.locator('input[id^="field-"]');
  await expect(fieldInputs.first()).toBeVisible();
  const editableIndex = (await fieldInputs.count()) > 1 ? 1 : 0;
  const editableField = fieldInputs.nth(editableIndex);
  const currentValue = await editableField.inputValue();
  await editableField.fill(currentValue ? `${currentValue} (reviewed)` : "Reviewed override");

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(`http://localhost:3100/processes/${reusableReadyProcessId}`, {
    timeout: 2 * 60 * 1000,
  });
  await page.getByRole("link", { name: "View all jobs" }).click();
  await expect(page).toHaveURL(`http://localhost:3100/processes/${reusableReadyProcessId}/jobs`);

  await page.getByLabel("Reviewed").selectOption("reviewed");
  await page.getByLabel("File name").fill(uploadedFileName);

  const reviewedRow = rowForFileName(page, uploadedFileName).first();
  await expect(reviewedRow).toContainText("Reviewed");
  await expect(reviewedRow).toContainText(uploadedFileName);
});

test("unclassified path shows explanatory guidance instead of an error", async ({ page, request }) => {
  let processId: string | null = null;
  const uploadedFileName = `unrelated-${Date.now()}.pdf`;

  try {
    const process = await createProcessViaUi(page, request, {
      processLabel: "Playwright unclassified path",
    });
    processId = process.processId;

    await uploadSample(page, "unrelated.pdf", uploadedFileName);

    await expect(page.getByText(/didn.?t match any configured form/i)).toBeVisible({
      timeout: 5 * 60 * 1000,
    });
    await expect(rowForFileName(page, uploadedFileName).first()).toContainText("No matching form");
    await expect(page.getByText(/processing failed/i)).toHaveCount(0);
  } finally {
    if (processId) {
      cleanupProcess(processId);
    }
  }
});

test("failed jobs show retry and retry creates a new visible job", async ({ page, request }) => {
  let processId: string | null = null;
  const uploadedFileName = `retry-source-${Date.now()}.pdf`;

  try {
    processId = reusableReadyProcessId;
    if (!processId) {
      const process = await createProcessViaUi(page, request, {
        processLabel: "Playwright retry path",
      });
      processId = process.processId;
      reusableReadyProcessId = processId;
    }

    seedFailedJob(processId, {
      uploadedFileName,
    });

    await page.goto(`/processes/${processId}/jobs?fileName=${encodeURIComponent(uploadedFileName)}`);

    const initialRow = rowForFileName(page, uploadedFileName).first();
    await expect(initialRow).toContainText("Failed");
    await expect(initialRow).toContainText("Forced Playwright worker-side failure for retry coverage.");

    await initialRow.getByRole("button", { name: "Retry" }).click();

    const matchingRows = rowForFileName(page, uploadedFileName);
    await expect(matchingRows).toHaveCount(2, { timeout: 5 * 60 * 1000 });
    await expect(matchingRows.first()).not.toContainText("Failed", { timeout: 5 * 60 * 1000 });
  } finally {
    if (processId && processId !== reusableReadyProcessId) {
      cleanupProcess(processId);
    }
  }
});
