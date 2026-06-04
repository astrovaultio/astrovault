import type { SVGProps } from "react";

declare module "react" {
  export type ReactSVG = SVGProps<SVGSVGElement>;
}
