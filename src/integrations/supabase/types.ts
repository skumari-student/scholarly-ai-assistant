export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_usage: {
        Row: {
          created_at: string
          id: string
          input_tokens: number | null
          kind: string
          model: string | null
          output_tokens: number | null
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          input_tokens?: number | null
          kind: string
          model?: string | null
          output_tokens?: number | null
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          input_tokens?: number | null
          kind?: string
          model?: string | null
          output_tokens?: number | null
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      datasets: {
        Row: {
          columns: Json
          created_at: string
          id: string
          kind: string
          name: string
          project_id: string
          row_count: number
          sample: Json
          source: string
          text_content: string | null
          updated_at: string
          upload_id: string | null
          user_id: string
        }
        Insert: {
          columns?: Json
          created_at?: string
          id?: string
          kind?: string
          name: string
          project_id: string
          row_count?: number
          sample?: Json
          source?: string
          text_content?: string | null
          updated_at?: string
          upload_id?: string | null
          user_id: string
        }
        Update: {
          columns?: Json
          created_at?: string
          id?: string
          kind?: string
          name?: string
          project_id?: string
          row_count?: number
          sample?: Json
          source?: string
          text_content?: string | null
          updated_at?: string
          upload_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "datasets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "datasets_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_cache: {
        Row: {
          fetched_at: string
          issn: string
          payload: Json
          source: string
        }
        Insert: {
          fetched_at?: string
          issn: string
          payload?: Json
          source: string
        }
        Update: {
          fetched_at?: string
          issn?: string
          payload?: Json
          source?: string
        }
        Relationships: []
      }
      journal_shortlist: {
        Row: {
          created_at: string
          fit: Json | null
          homepage: string | null
          id: string
          issn: string
          notes: string
          order: number
          project_id: string
          publisher: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          fit?: Json | null
          homepage?: string | null
          id?: string
          issn: string
          notes?: string
          order?: number
          project_id: string
          publisher?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          fit?: Json | null
          homepage?: string | null
          id?: string
          issn?: string
          notes?: string
          order?: number
          project_id?: string
          publisher?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_shortlist_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_suggestions: {
        Row: {
          audience: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          open_access: string | null
          pinned: boolean
          project_id: string
          requirements: string | null
          scope: string | null
          url: string | null
        }
        Insert: {
          audience?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          open_access?: string | null
          pinned?: boolean
          project_id: string
          requirements?: string | null
          scope?: string | null
          url?: string | null
        }
        Update: {
          audience?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          open_access?: string | null
          pinned?: boolean
          project_id?: string
          requirements?: string | null
          scope?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_suggestions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
        }
        Relationships: []
      }
      project_visuals: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          kind: string
          order: number
          payload: Json
          project_id: string
          section_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          kind: string
          order?: number
          payload?: Json
          project_id: string
          section_id?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          kind?: string
          order?: number
          payload?: Json
          project_id?: string
          section_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_visuals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_visuals_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          citation_style: string
          context_notes: string | null
          created_at: string
          discipline: string | null
          doc_type: string
          id: string
          language_level: string
          mode: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          citation_style?: string
          context_notes?: string | null
          created_at?: string
          discipline?: string | null
          doc_type: string
          id?: string
          language_level?: string
          mode?: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          citation_style?: string
          context_notes?: string | null
          created_at?: string
          discipline?: string | null
          doc_type?: string
          id?: string
          language_level?: string
          mode?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      refs: {
        Row: {
          authors: string
          cite_key: string
          container: string | null
          created_at: string
          doi: string | null
          id: string
          project_id: string
          publisher: string | null
          title: string
          url: string | null
          year: number | null
        }
        Insert: {
          authors: string
          cite_key: string
          container?: string | null
          created_at?: string
          doi?: string | null
          id?: string
          project_id: string
          publisher?: string | null
          title: string
          url?: string | null
          year?: number | null
        }
        Update: {
          authors?: string
          cite_key?: string
          container?: string | null
          created_at?: string
          doi?: string | null
          id?: string
          project_id?: string
          publisher?: string | null
          title?: string
          url?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "refs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sections: {
        Row: {
          content: string
          id: string
          key: string
          order: number
          outline: string | null
          project_id: string
          title: string
          updated_at: string
        }
        Insert: {
          content?: string
          id?: string
          key: string
          order?: number
          outline?: string | null
          project_id: string
          title: string
          updated_at?: string
        }
        Update: {
          content?: string
          id?: string
          key?: string
          order?: number
          outline?: string | null
          project_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      submissions: {
        Row: {
          checklist: Json
          cover_letter: string
          created_at: string
          package: Json
          project_id: string
          status: string
          submitted_at: string | null
          target_issn: string | null
          target_title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          checklist?: Json
          cover_letter?: string
          created_at?: string
          package?: Json
          project_id: string
          status?: string
          submitted_at?: string | null
          target_issn?: string | null
          target_title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          checklist?: Json
          cover_letter?: string
          created_at?: string
          package?: Json
          project_id?: string
          status?: string
          submitted_at?: string | null
          target_issn?: string | null
          target_title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "submissions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      topics: {
        Row: {
          created_at: string
          description: string | null
          id: string
          pinned: boolean
          project_id: string
          research_questions: string | null
          title: string
          trend_note: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          pinned?: boolean
          project_id: string
          research_questions?: string | null
          title: string
          trend_note?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          pinned?: boolean
          project_id?: string
          research_questions?: string | null
          title?: string
          trend_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "topics_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      uploads: {
        Row: {
          created_at: string
          id: string
          kind: string
          mime: string
          name: string
          path: string
          project_id: string
          section_id: string | null
          size: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: string
          mime: string
          name: string
          path: string
          project_id: string
          section_id?: string | null
          size?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          mime?: string
          name?: string
          path?: string
          project_id?: string
          section_id?: string | null
          size?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "uploads_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uploads_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_transcripts: {
        Row: {
          created_at: string
          id: string
          kind: string
          project_id: string
          section_id: string | null
          text: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: string
          project_id: string
          section_id?: string | null
          text: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          project_id?: string
          section_id?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_transcripts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_transcripts_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
