export const BASE_CURRENCY = "USDC";

export interface Order {
    price : number;
    quantity: number;
    orderId: string;
    filled: number;
    side: "buy" | "sell",
    userId: string;
}

export interface Fill {
    price: number;
    quantity: number;
    tradeId: number;
    otherUserId: string;
    marketOrderId: string;
}

export interface Depth {
    asks: [string, string][],
    bids: [string, string][]
}
