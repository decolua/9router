import { getSettings } from "@/lib/localDb";

let rtkEnabled = true;

export function getRtkEnabled(): boolean {
  return rtkEnabled;
}

export async function refreshRtkFlag(): Promise<boolean> {
  const settings = await getSettings();
  rtkEnabled = settings.enableRtk !== false;
  return rtkEnabled;
}

export function setRtkEnabled(value: boolean): void {
  rtkEnabled = value;
}
