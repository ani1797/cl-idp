import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { expect, type APIRequestContext, type Page } from "@playwright/test";

const repoRoot = path.resolve(__dirname, "../../..");
const apiRoot = path.resolve(repoRoot, "apps/api");
const samplesRoot = path.resolve(repoRoot, "samples");
const apiBaseUrl = "http://localhost:8010";

type Analyzer = {
  id: string;
  name: string;
};

type CreateProcessResult = {
  processId: string;
  processName: string;
};

type SeedFailedJobResult = {
  jobId: string;
  fileName: string;
};

const processDetailUrlPattern = /\/processes\/[0-9a-f-]{36}$/i;

function getSampleBuffer(fileName: string) {
  return fs.readFileSync(path.join(samplesRoot, fileName));
}

function getContentType(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();

  switch (extension) {
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    default:
      throw new Error(`Unsupported sample extension for ${fileName}`);
  }
}

export function rowForFileName(page: Page, fileName: string) {
  return page.locator("tbody tr").filter({ hasText: fileName });
}

export async function getAnalyzerById(request: APIRequestContext, analyzerId: string) {
  const response = await request.get(`${apiBaseUrl}/analyzers`);
  expect(response.ok()).toBeTruthy();

  const analyzers = (await response.json()) as Analyzer[];
  const analyzer = analyzers.find((item) => item.id === analyzerId);
  expect(analyzer, `Expected analyzer ${analyzerId} to be available.`).toBeTruthy();

  return analyzer as Analyzer;
}

export async function createProcessViaUi(
  page: Page,
  request: APIRequestContext,
  {
    analyzerId = "prebuilt-invoice",
    processLabel,
    waitForUploadReady = true,
  }: {
    analyzerId?: string;
    processLabel: string;
    waitForUploadReady?: boolean;
  },
): Promise<CreateProcessResult> {
  const analyzer = await getAnalyzerById(request, analyzerId);
  const processName = `${processLabel} ${Date.now()}`;
  const description = `${processLabel} created by the live Playwright suite.`;

  await page.goto("/processes/new", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "New business process" })).toBeVisible();

  const nameInput = page.locator("#name");
  const descriptionInput = page.locator("#description");
  const thresholdInput = page.locator("#confidenceThresholdPercent");
  const ownerEmailInput = page.locator("#ownerEmail");

  const invoiceCheckbox = page
    .locator("label")
    .filter({ hasText: analyzer.name })
    .locator('input[type="checkbox"]');

  async function fillProcessForm() {
    await expect(nameInput).toBeEditable();
    await nameInput.fill(processName);
    await expect(nameInput).toHaveValue(processName);

    await expect(descriptionInput).toBeEditable();
    await descriptionInput.fill(description);
    await expect(descriptionInput).toHaveValue(description);

    await invoiceCheckbox.check();
    await thresholdInput.fill("100");
    await expect(thresholdInput).toHaveValue("100");
    await ownerEmailInput.fill("owner@example.com");
    await expect(ownerEmailInput).toHaveValue("owner@example.com");
  }

  let created = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await fillProcessForm();
    await page.getByRole("button", { name: "Save process" }).click();

    try {
      await expect(page).toHaveURL(processDetailUrlPattern, { timeout: 15_000 });
      created = true;
      break;
    } catch {
      await expect(page).toHaveURL(/\/processes\/new$/, { timeout: 5_000 });
    }
  }

  expect(created).toBeTruthy();
  await expect(page).toHaveURL(processDetailUrlPattern, { timeout: 3 * 60 * 1000 });
  const processId = page.url().match(/\/processes\/([0-9a-f-]{36})$/i)?.[1];
  expect(processId).toBeTruthy();

  if (waitForUploadReady) {
    await expect(page.getByLabel("Choose document")).toBeEnabled({ timeout: 3 * 60 * 1000 });
  }

  return {
    processId: processId as string,
    processName,
  };
}

export async function uploadSample(page: Page, sampleFileName: string, uploadedFileName: string) {
  await page.getByLabel("Choose document").setInputFiles({
    name: uploadedFileName,
    mimeType: getContentType(sampleFileName),
    buffer: getSampleBuffer(sampleFileName),
  });
}

export function cleanupProcess(processId: string) {
  execFileSync(
    "uv",
    ["run", "python", "scripts/e2e_support.py", "cleanup-process", "--process-id", processId],
    {
      cwd: apiRoot,
      env: process.env,
      stdio: "pipe",
    },
  );
}

export function seedFailedJob(
  processId: string,
  {
    sampleFileName = "invoice.pdf",
    uploadedFileName,
    error = "Forced Playwright worker-side failure for retry coverage.",
  }: {
    sampleFileName?: string;
    uploadedFileName: string;
    error?: string;
  },
): SeedFailedJobResult {
  const output = execFileSync(
    "uv",
    [
      "run",
      "python",
      "scripts/e2e_support.py",
      "seed-failed-job",
      "--process-id",
      processId,
      "--file-path",
      path.join(samplesRoot, sampleFileName),
      "--file-name",
      uploadedFileName,
      "--error",
      error,
    ],
    {
      cwd: apiRoot,
      env: process.env,
      encoding: "utf8",
      stdio: "pipe",
    },
  );

  return JSON.parse(output) as SeedFailedJobResult;
}
