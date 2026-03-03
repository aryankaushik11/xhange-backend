import { BASE_CURRENCY, Depth, Fill, Order } from "../types/orderbook";


export class Orderbook {
    //bids and asks array of order
    bids: Order[];
    asks: Order[];
    depth: Depth;
    baseAsset: string;
    quoteAsset: string = BASE_CURRENCY;
    lastTradeId: number;
    currentPrice: number;

    //initialise orderbook
    constructor(baseAsset: string, bids: Order[], asks: Order[], lastTradeId: number, currentPrice: number) {
        this.baseAsset = baseAsset;
        this.bids = bids;
        this.asks = asks;
        this.depth = { asks: [], bids: [] };
        this.lastTradeId = lastTradeId;
        this.currentPrice = currentPrice;
    }

    //get the market of this orderbook
    ticker() {
        return `${this.baseAsset}_${this.quoteAsset}`;
    }

    //get current snapshot of the orderbook
    getSnapshot() {
        return {
            asks: this.asks,
            bids: this.bids,
            baseAsset: this.baseAsset,
            quoteAsset: this.quoteAsset,
            lastTradeId: this.lastTradeId,
            currentPrice: this.currentPrice
        }
    }


    //add new order
    addOrder(order: Order): { executedQty: number, fills: Fill[] } {

        //if order is to buy the asset
        if(order.side === "buy") {
            //go and match the bid with asks
            const { executedQty, fills } = this.matchBid(order);
            order.filled = executedQty;

            //if entire quantity is filled,
            // don't put in depth and return
            if(executedQty === order.quantity) {
                return {
                    executedQty,
                    fills
                }
            }
            //else, place the order on bids table and calculate the depth
            this.bids.push(order);
            
            //Depth calculation

            //check if this price already exists in depth bids array
            const priceIndex = this.depth.bids.findIndex(bid => bid[0] === order.price.toString());

            //if it doesn't, push the current price on the orderbook with the remaining quantity
            if(priceIndex === -1) {
                this.depth.bids.push([order.price.toString(), (order.quantity - order.filled).toString()]);
            }
            else {  //if this price already exists, increase its quantity
                const existingQty = parseFloat(this.depth.bids[priceIndex][1]);
                const newQty = existingQty + (order.quantity - order.filled);
                this.depth.bids[priceIndex][1] = newQty.toString();
            }

            return {
                executedQty,
                fills
            }
        }
        else {    //else if the order is to sell the asset

            //match the ask with the existing bids
            const { executedQty, fills } = this.matchAsk(order);
            order.filled = executedQty;
            //if entire order is filled, return
            if(executedQty === order.quantity) {
                return {
                    executedQty,
                    fills
                }
            }
            //if not, place the order in asks table and calculate depth
            this.asks.push(order);

            //Depth calculation

            //check if the current price already exists in the depth asks,
            const priceIndex = this.depth.asks.findIndex(ask => ask[0] === order.price.toString());

            //if it doesn't, push the new price with the remaining quantity
            if(priceIndex === -1) {
                this.depth.asks.push([order.price.toString(), (order.quantity - order.filled).toString()]);
            }
            else {  //if it does, increase the quantity
                const existingQty = parseFloat(this.depth.asks[priceIndex][1]);
                const newQty = existingQty + (order.quantity - order.filled);
                this.depth.asks[priceIndex][1] = newQty.toString();
            }            

            return {
                executedQty,
                fills
            }
        }   
    }

    //Match order function
    matchBid(order: Order): { executedQty: number, fills: Fill[] } {
        //create an empty fills array and executedQty
        const fills: Fill[] = [];
        let executedQty = 0;

        //sort the asks first in ascending order of price
        this.asks.sort((a, b) => a.price - b.price);

        //go through all the orders in the asks
        for(let i = 0; i < this.asks.length; i++) {
            //if entire order is filled, break from the loop
            if(executedQty === order.quantity)
                break;

            //if current ask's price is less than the order's price, match it
            if(this.asks[i].price <= order.price) {

                const filledQty = Math.min((order.quantity - executedQty), (this.asks[i].quantity - this.asks[i].filled));
                this.asks[i].filled += filledQty;
                executedQty += filledQty;

                //push in the fills array
                fills.push({
                    price: this.asks[i].price,
                    quantity: filledQty,
                    tradeId: this.lastTradeId++,
                    otherUserId: this.asks[i].userId,
                    marketOrderId: this.asks[i].orderId
                });

                //remove the current ask if its completely filled
                if(this.asks[i].filled === this.asks[i].quantity) {
                    this.asks.splice(i, 1);
                    i--;
                }
            }
        }
        //return the fills and executedQty
        return {
            executedQty,
            fills
        }
        
    }

    matchAsk(order: Order): { executedQty: number, fills: Fill[]} {
        let executedQty = 0;
        const fills: Fill[] = [];

        //sort all the bids
        this.bids.sort((a, b) => a.price - b.price);

        //go through all the bids
        for(let i = 0; i < this.bids.length; i++) {
            //if order is completely filled, break from the loop
            if(executedQty === order.quantity)
                break;
            
            //if current bid's price is greater than the order's price, match it
            if(this.bids[i].price >= order.price) {
                const filledQty = Math.min((order.quantity - executedQty), (this.bids[i].quantity - this.bids[i].filled));
                executedQty += filledQty;
                this.bids[i].filled += executedQty;

                //push to fills array
                fills.push({
                    price: order.price,
                    quantity: filledQty,
                    tradeId: this.lastTradeId++,
                    otherUserId: this.bids[i].userId,
                    marketOrderId: this.bids[i].orderId
                })
            }

            // if current bid is completely filled, remove it from the bids table
            if(this.bids[i].quantity === this.bids[i].filled) {
                this.bids.splice(i, 1);
                i--;
            }
        }

        return {
            executedQty,
            fills
        }
    }

    getDepth(): Depth {
        //sort the depth in ascending order of prices
        this.depth.asks.sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
        this.depth.bids.sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));

        return this.depth;
    }

    getOrder(orderId: string) {
        let order = this.asks.find(a => a.orderId === orderId);
        if(!order) {
            order = this.bids.find(b => b.orderId === orderId);
        }
        return order;
    }

    getOpenOrders(userId: string): {asks: Order[], bids:  Order[]} {
        const asks = this.asks.filter(x => x.userId === userId);
        const bids = this.bids.filter(x => x.userId === userId);

        return {
            asks,
            bids
        };
    }

    cancelBid(order: Order) {
        const index = this.bids.findIndex(x => x.userId === order.userId);
        if(index !== -1) {
            const price = this.bids[index].price;
            this.bids.splice(index, 1);

            //update depth

            const qtyToReduce = (order.quantity - order.filled);
            const bid = this.depth.bids.find(b => b[0] === order.price.toString());
            //@ts-ignore
            const newPrice = Number(bid[1]) - qtyToReduce;
            //@ts-ignore
            this.depth.bids.find(b => b[0] === order.price.toString())[1] = newPrice.toString();

            return price;
        }
    }

    cancelAsk(order: Order) {
        const index = this.asks.findIndex(x => x.userId === order.userId);
        if(index !== -1) {
            const price = this.asks[index].price;
            this.asks.splice(index, 1);

            //update depth
            const qtyToReduce = order.quantity - order.filled;
            const ask = this.depth.asks.find(a => a[0] === order.price.toString());

            //@ts-ignore
            const newPrice = Number(ask[1]) - qtyToReduce;
            //@ts-ignore
            this.depth.asks.find(a => a[0] === order.price.toString())[1] = newPrice.toString();

            return price;
        }
    }
}