// SPDX-License-Identifier: AGPL-3.0-only

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

Object.assign(navigator, {
  clipboard: {
    writeText: async () => undefined,
  },
});

globalThis.URL.createObjectURL = () => "blob:test";
globalThis.URL.revokeObjectURL = () => undefined;
