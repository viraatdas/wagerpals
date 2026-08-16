'use client';

import { StackProvider } from "@stackframe/stack";
import { stackClientApp } from "@/lib/stack-client";
import { ReactNode } from "react";
import NavigationProgress from "./NavigationProgress";

export function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <StackProvider app={stackClientApp}>
      <NavigationProgress />
      {children}
    </StackProvider>
  );
}
