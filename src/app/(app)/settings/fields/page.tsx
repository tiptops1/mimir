import { getTenantDb } from "@/lib/tenant-context";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { FieldDefsManager, type FieldDefRow } from "@/components/field-defs-manager";
import type { ConfigEntity, FieldSource, FieldType } from "@/lib/field-config";

const ENTITIES: { value: ConfigEntity; label: string }[] = [
  { value: "COMPANY", label: "Sociétés" },
  { value: "CONTACT", label: "Contacts" },
  { value: "DEAL", label: "Deals" },
];

export default async function SettingsFieldsPage() {
  const prisma = await getTenantDb();
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
      {ENTITIES.map(({ value, label }) => (
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
