import type { VeilleApi } from "@shared/types";

export const api = (window as unknown as { veille: VeilleApi }).veille;
