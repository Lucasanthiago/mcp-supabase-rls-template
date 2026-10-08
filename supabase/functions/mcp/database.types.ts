export type Json = string | number | boolean | null | {
  [key: string]: Json | undefined;
} | Json[];

export type Database = {
  "graphql_public": {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      "graphql": {
        Args: {
          "extensions"?: Json;
          "operationName"?: string;
          "query"?: string;
          "variables"?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  "public": {
    Tables: {
      "exames": {
        Row: {
          "criado_em": string;
          "criado_por": string | null;
          "id": string;
          "organizacao_id": string;
          "paciente_id": string;
          "realizado_em": string;
          "resultado": string | null;
          "tipo": string;
        };
        ComputedFields: never;
        Insert: {
          "criado_em"?: string;
          "criado_por"?: string | null;
          "id"?: string;
          "organizacao_id": string;
          "paciente_id": string;
          "realizado_em"?: string;
          "resultado"?: string | null;
          "tipo": string;
        };
        Update: {
          "criado_em"?: string;
          "criado_por"?: string | null;
          "id"?: string;
          "organizacao_id"?: string;
          "paciente_id"?: string;
          "realizado_em"?: string;
          "resultado"?: string | null;
          "tipo"?: string;
        };
        Relationships: [
          {
            foreignKeyName: "exames_paciente_id_organizacao_id_fkey";
            columns: ["paciente_id", "organizacao_id"];
            isOneToOne: false;
            referencedRelation: "pacientes";
            referencedColumns: ["id", "organizacao_id"];
          },
        ];
      };
      "membros": {
        Row: {
          "criado_em": string;
          "id": string;
          "organizacao_id": string;
          "papel": Database["public"]["Enums"]["papel_membro"];
          "user_id": string;
        };
        ComputedFields: never;
        Insert: {
          "criado_em"?: string;
          "id"?: string;
          "organizacao_id": string;
          "papel"?: Database["public"]["Enums"]["papel_membro"];
          "user_id": string;
        };
        Update: {
          "criado_em"?: string;
          "id"?: string;
          "organizacao_id"?: string;
          "papel"?: Database["public"]["Enums"]["papel_membro"];
          "user_id"?: string;
        };
        Relationships: [
          {
            foreignKeyName: "membros_organizacao_id_fkey";
            columns: ["organizacao_id"];
            isOneToOne: false;
            referencedRelation: "organizacoes";
            referencedColumns: ["id"];
          },
        ];
      };
      "organizacoes": {
        Row: {
          "criado_em": string;
          "id": string;
          "nome": string;
        };
        ComputedFields: never;
        Insert: {
          "criado_em"?: string;
          "id"?: string;
          "nome": string;
        };
        Update: {
          "criado_em"?: string;
          "id"?: string;
          "nome"?: string;
        };
        Relationships: [];
      };
      "pacientes": {
        Row: {
          "criado_em": string;
          "criado_por": string | null;
          "data_nascimento": string | null;
          "id": string;
          "nome": string;
          "organizacao_id": string;
        };
        ComputedFields: never;
        Insert: {
          "criado_em"?: string;
          "criado_por"?: string | null;
          "data_nascimento"?: string | null;
          "id"?: string;
          "nome": string;
          "organizacao_id": string;
        };
        Update: {
          "criado_em"?: string;
          "criado_por"?: string | null;
          "data_nascimento"?: string | null;
          "id"?: string;
          "nome"?: string;
          "organizacao_id"?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pacientes_organizacao_id_fkey";
            columns: ["organizacao_id"];
            isOneToOne: false;
            referencedRelation: "organizacoes";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      "is_admin": { Args: { "org": string }; Returns: boolean };
      "is_membro": { Args: { "org": string }; Returns: boolean };
    };
    Enums: {
      "papel_membro": "admin" | "medico";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema =
  DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof (
      & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
        "Tables"
      ]
      & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
        "Views"
      ]
    )
    : never = never,
> = DefaultSchemaTableNameOrOptions extends
  { schema: keyof DatabaseWithoutInternals } ? (
    & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
      "Tables"
    ]
    & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
      "Views"
    ]
  )[TableName] extends {
    Row: infer R;
  } ? R
  : never
  : DefaultSchemaTableNameOrOptions extends
    keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[
      DefaultSchemaTableNameOrOptions
    ] extends {
      Row: infer R;
    } ? R
    : never
  : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
      "Tables"
    ]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends
  { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
    "Tables"
  ][TableName] extends {
    Insert: infer I;
  } ? I
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I;
    } ? I
    : never
  : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
      "Tables"
    ]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends
  { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
    "Tables"
  ][TableName] extends {
    Update: infer U;
  } ? U
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U;
    } ? U
    : never
  : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]][
      "Enums"
    ]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends
  { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][
    EnumName
  ]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[
      PublicCompositeTypeNameOrOptions["schema"]
    ]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends
  { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]][
    "CompositeTypes"
  ][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never;

export const Constants = {
  "graphql_public": {
    Enums: {},
  },
  "public": {
    Enums: {
      "papel_membro": ["admin", "medico"],
    },
  },
} as const;
