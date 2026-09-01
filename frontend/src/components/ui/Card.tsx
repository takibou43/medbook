import { HTMLAttributes } from "react";
import clsx from "clsx";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("card p-5", className)} {...rest} />;
}
