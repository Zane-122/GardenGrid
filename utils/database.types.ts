export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      plant_basic_info: {
        Row: {
          common_names: string[]
          edible_parts: string[]
          gbif_id: number | null
          image_url: string | null
          inaturalist_id: number | null
          plant_id: string
          propagation_methods: string[]
          rank: string | null
          scientific_name: string | null
          taxonomy: Json | null
          updated_at: string
          url: string | null
          watering: Json | null
        }
        Insert: {
          common_names?: string[]
          edible_parts?: string[]
          gbif_id?: number | null
          image_url?: string | null
          inaturalist_id?: number | null
          plant_id: string
          propagation_methods?: string[]
          rank?: string | null
          scientific_name?: string | null
          taxonomy?: Json | null
          updated_at?: string
          url?: string | null
          watering?: Json | null
        }
        Update: {
          common_names?: string[]
          edible_parts?: string[]
          gbif_id?: number | null
          image_url?: string | null
          inaturalist_id?: number | null
          plant_id?: string
          propagation_methods?: string[]
          rank?: string | null
          scientific_name?: string | null
          taxonomy?: Json | null
          updated_at?: string
          url?: string | null
          watering?: Json | null
        }
        Relationships: []
      }
      plants: {
        Row: {
          created_at: string
          id: string
          plant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          plant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          plant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'plants_plant_id_fkey'
            columns: ['plant_id']
            isOneToOne: false
            referencedRelation: 'plant_basic_info'
            referencedColumns: ['plant_id']
          },
          {
            foreignKeyName: 'plants_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          tutorial_completed: boolean
          username: string | null
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          tutorial_completed?: boolean
          username?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          tutorial_completed?: boolean
          username?: string | null
        }
        Relationships: []
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
