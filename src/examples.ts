import type { Files } from "./engine";

export const EXAMPLES: Record<string, Files> = {
  "Design system page": {
    "App.tsx": `import { useState } from "react";
import { Badge, Button, Disclosure, MockShell, Stack, Text } from "@ds/ui";
import { PlanCard } from "./components/PlanCard";
import "./styles.css";

const plans = [
  { name: "Starter", price: 0, features: ["1 project", "Community support"] },
  { name: "Team", price: 29, features: ["10 projects", "Email support", "SSO"], popular: true },
  { name: "Enterprise", price: 99, features: ["Unlimited projects", "Dedicated support", "Audit log"] },
];

export default function App() {
  const [yearly, setYearly] = useState(false);
  return (
    <MockShell title="Acme Cloud">
      <Stack gap={6}>
        <Stack gap={2}>
          <Text size="xl">Pricing</Text>
          <Stack direction="row" gap={2}>
            <Button variant={yearly ? "secondary" : "primary"} onClick={() => setYearly(false)}>Monthly</Button>
            <Button variant={yearly ? "primary" : "secondary"} onClick={() => setYearly(true)}>Yearly</Button>
            {yearly && <Badge tone="success">2 months free</Badge>}
          </Stack>
        </Stack>
        <div className="plans">
          {plans.map((plan) => (
            <PlanCard key={plan.name} {...plan} yearly={yearly} />
          ))}
        </div>
        <Disclosure summary="Can I change plans later?">
          Yes. Upgrades apply immediately; downgrades at the end of the billing period.
        </Disclosure>
      </Stack>
    </MockShell>
  );
}
`,
    "components/PlanCard.tsx": `import { Badge, Button, Card, Stack, Text } from "@ds/ui";

type Props = { name: string; price: number; features: string[]; popular?: boolean; yearly: boolean };

export function PlanCard({ name, price, features, popular, yearly }: Props) {
  const shown = yearly ? price * 10 : price;
  return (
    <Card title={<>{name} {popular && <Badge tone="warning">Popular</Badge>}</>}>
      <Stack gap={3}>
        <Text size="lg">\${shown}<span className="per">/{yearly ? "yr" : "mo"}</span></Text>
        <ul className="features">
          {features.map((f) => <li key={f}>{f}</li>)}
        </ul>
        <Button variant={popular ? "primary" : "secondary"}>Choose {name}</Button>
      </Stack>
    </Card>
  );
}
`,
    "styles.css": `.plans {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}
.features { margin: 0; padding-left: 18px; color: var(--ds-muted); }
.per { font-size: .8rem; color: var(--ds-muted); margin-left: 2px; }
`,
  },

  "Plain React counter": {
    "App.tsx": `import { useState } from "react";

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Count: {count}</h1>
      <button onClick={() => setCount(count + 1)}>Increment</button>
    </div>
  );
}
`,
  },

  "Disallowed import": {
    "App.tsx": `import _ from "lodash";

export default function App() {
  return <div>{_.capitalize("this never compiles")}</div>;
}
`,
  },

  "Runtime error": {
    "App.tsx": `import { useState } from "react";
import { Button, MockShell, Text } from "@ds/ui";

function Broken() {
  throw new Error("Broken component failed to render");
}

export default function App() {
  const [boom, setBoom] = useState(false);
  return (
    <MockShell>
      <Text>Click to render a component that throws.</Text>
      <Button onClick={() => setBoom(true)}>Break it</Button>
      {boom && <Broken />}
    </MockShell>
  );
}
`,
  },
};

export const DEFAULT_EXAMPLE = "Design system page";
