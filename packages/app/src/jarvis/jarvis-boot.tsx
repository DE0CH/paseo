import { useEffect } from "react";
import { bootJarvis } from "./jarvis";

/** Starts the Jarvis sync once the app is up (no-op outside Deyao's build). */
export function JarvisBoot() {
  useEffect(() => {
    bootJarvis();
  }, []);
  return null;
}
