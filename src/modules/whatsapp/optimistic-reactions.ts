import type { InboxMessageItem } from "./inbox-types";
export function withOwnReaction(reactions: InboxMessageItem["reactions"], emoji: string) {
  const next=(reactions??[]).map(item=>item.mine?{...item,count:item.count-1,mine:false,reactorIds:item.reactorIds?.filter(id=>id!=="me")}:item).filter(item=>item.count>0);
  if(!emoji)return next;
  const existing=next.find(item=>item.emoji===emoji);
  if(existing)return next.map(item=>item===existing?{...item,count:item.count+1,mine:true,reactorIds:item.reactorIds?[...item.reactorIds,"me"]:undefined}:item);
  return [...next,{emoji,count:1,mine:true,reactorIds:["me"]}];
}
