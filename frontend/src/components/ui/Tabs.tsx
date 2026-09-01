import { ReactNode, useState } from "react";
import clsx from "clsx";

interface Tab {
  id: string;
  label: string;
  content: ReactNode;
}

export function Tabs({ tabs, defaultTab }: { tabs: Tab[]; defaultTab?: string }) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.id);
  const activeTab = tabs.find((t) => t.id === active);

  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={clsx(
              "border-b-2 px-4 py-2.5 text-sm font-semibold transition",
              active === t.id ? "border-primary-600 text-primary-700" : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div>{activeTab?.content}</div>
    </div>
  );
}
