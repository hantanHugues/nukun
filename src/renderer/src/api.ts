import type { NukunApi } from "@shared/types";

export const api = (window as unknown as { nukun: NukunApi }).nukun;
