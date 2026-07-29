import { getTenantDb } from "@/lib/tenant-context";
import { getTenantProfile, hasModule, type TenantModule } from "@/lib/tenant-profile";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { FieldDefsManager, type FieldDefRow } from "@/components/field-defs-manager";
import type { ConfigEntity, FieldSource, FieldType } from "@/lib/field-config";

// Keep in sync with ConfigEntity in src/lib/field-config.ts. Each entity is
// gated on the module that owns it — a Chronos-only tenant has no companies or
// deals, so offering to configure their fields would be broker vocabulary
// leaking into a rebranded shell (the defect class S26 fixed in the sidebar).
const ENTITIES: {
  value: ConfigEntity;
  label: string;
  module: TenantModule;
}[] = [
  { value: "COMPANY", label: "Sociétés", module: "crm" },
  { value: "CONTACT", label: "Contacts", module: "crm" },
  { value: "DEAL", label: "Deals", module: "crm" },
  { value: "FINANCE", label: "Finances", module: "crm" },
  { value: "INVENTORY_UNIT", label: "Pièces", module: "chronos" },
];

export default async function SettingsFieldsPage() {
  const prisma = await getTenantDb();
  const profile = await getTenantProfile();
  const entities = ENTITIES.filter((e) => hasModule(profile.modules, e.module));
  const rows = await prisma.fieldDefinition.findMany({
    orderBy: [{ entity: "asc" }, { order: "asc" }, { label: "asc" }],
  });

  const byEntity = new Map<ConfigEntity, FieldDefRow[]>();
  for (const r of rows) {
    const def: FieldDefRow = {
      id: r.id,
      key: r.key,
      label: r.label,
      type: r.type as FieldType,
      options: r.options,
      required: r.required,
      order: r.order,
      source: r.source as FieldSource,
      section: r.section,
    };
    const entity = r.entity as ConfigEntity;
    const list = byEntity.get(entity) ?? [];
    list.push(def);
    byEntity.set(entity, list);
  }

  return (
    <div className="space-y-6">
      {entities.map(({ value, label }) => (
        <Card key={value}>
          <CardHeader>
            <CardTitle>{label}</CardTitle>
          </CardHeader>
          <CardBody>
            <FieldDefsManager entity={value} defs={byEntity.get(value) ?? []} />
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
