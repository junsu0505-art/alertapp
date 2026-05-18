export type Direction = 'cross_above' | 'cross_below'
export type Status = 'armed' | 'triggered' | 'paused'

export interface TrendlinePoint {
  time: number   // unix seconds
  price: number
}

export interface TrendlineAlert {
  id: string         // crypto.randomUUID()
  symbol: string     // e.g., "BTCUSDT"
  exchange: 'binance'
  tfLabel: string    // user 표기용 (e.g., "4H")
  p1: TrendlinePoint
  p2: TrendlinePoint
  direction: Direction
  status: Status
  createdAt: number
  triggeredAt: number | null
}

export interface TelegramConfig {
  botToken: string
  chatId: string
}

export interface Settings {
  telegram: TelegramConfig | null
  alerts: TrendlineAlert[]
}

export interface TickEvent {
  symbol: string
  price: number
  ts: number
}

export const EMPTY_SETTINGS: Settings = { telegram: null, alerts: [] }
