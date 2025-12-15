// src/core/analysis/context/schema-loader.ts
// Parses Prisma schema into a lightweight Map for fast lookups.
// Used by: SCHEMA_DRIFT, ORPHAN_RELATION_INCLUDE rules.

export interface PrismaField {
    name: string;
    type: string;
    isRelation: boolean;
    isOptional: boolean;
}

export interface PrismaModelInfo {
    name: string;
    fields: PrismaField[];
}

export type SchemaMap = Map<string, PrismaModelInfo>;

/**
 * Parse a Prisma schema file content into a SchemaMap.
 * Uses regex-based parsing (no @prisma/internals dependency).
 * 
 * @param schemaContent - Raw content of schema.prisma
 * @returns Map of model name -> model info
 */
export function parseSchema(schemaContent: string): SchemaMap {
    const schemaMap: SchemaMap = new Map();

    // Match model definitions: model User { ... }
    const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g;
    let modelMatch: RegExpExecArray | null;

    while ((modelMatch = modelRegex.exec(schemaContent)) !== null) {
        const modelName = modelMatch[1];
        const modelBody = modelMatch[2];
        const fields: PrismaField[] = [];

        // Parse each field line
        const lines = modelBody.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) continue;

            // Match field: fieldName Type? @relation(...)
            const fieldMatch = trimmed.match(/^(\w+)\s+(\w+)(\[\])?\??/);
            if (fieldMatch) {
                const [, fieldName, fieldType] = fieldMatch;
                const isRelation = /\@relation/.test(trimmed) || /\[\]/.test(trimmed);
                const isOptional = trimmed.includes('?');

                fields.push({
                    name: fieldName,
                    type: fieldType,
                    isRelation,
                    isOptional,
                });
            }
        }

        schemaMap.set(modelName, { name: modelName, fields });
    }

    return schemaMap;
}

/**
 * Get all field names for a model.
 */
export function getModelFields(schemaMap: SchemaMap, modelName: string): string[] {
    const model = schemaMap.get(modelName);
    return model ? model.fields.map(f => f.name) : [];
}

/**
 * Check if a field exists on a model.
 */
export function hasField(schemaMap: SchemaMap, modelName: string, fieldName: string): boolean {
    const fields = getModelFields(schemaMap, modelName);
    return fields.includes(fieldName);
}

/**
 * Get all relation field names for a model.
 */
export function getRelationFields(schemaMap: SchemaMap, modelName: string): string[] {
    const model = schemaMap.get(modelName);
    return model ? model.fields.filter(f => f.isRelation).map(f => f.name) : [];
}

/**
 * Lazy schema loader class for caching parsed schema.
 */
export class SchemaLoader {
    private schemaMap: SchemaMap | null = null;
    private schemaContent: string | null = null;

    /**
     * Load schema from content string.
     */
    load(schemaContent: string): SchemaMap {
        if (this.schemaContent === schemaContent && this.schemaMap) {
            return this.schemaMap;
        }
        this.schemaContent = schemaContent;
        this.schemaMap = parseSchema(schemaContent);
        return this.schemaMap;
    }

    /**
     * Get cached schema map (returns empty map if not loaded).
     */
    get(): SchemaMap {
        return this.schemaMap ?? new Map();
    }

    /**
     * Check if schema is loaded.
     */
    isLoaded(): boolean {
        return this.schemaMap !== null;
    }

    /**
     * Clear cached schema.
     */
    clear(): void {
        this.schemaMap = null;
        this.schemaContent = null;
    }
}

// Singleton instance for global use
export const schemaLoader = new SchemaLoader();
