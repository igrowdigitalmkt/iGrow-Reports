import {describe,it,expect} from "vitest";
import {withOwnReaction} from "@/modules/whatsapp/optimistic-reactions";
describe("optimistic reactions",()=>{
 it("keeps other people when changing the account reaction",()=>{expect(withOwnReaction([{emoji:"❤️",count:2,mine:true,reactorIds:["me","other"]}],"😂")).toEqual([{emoji:"❤️",count:1,mine:false,reactorIds:["other"]},{emoji:"😂",count:1,mine:true,reactorIds:["me"]}]);});
 it("removes only the account reaction",()=>{expect(withOwnReaction([{emoji:"❤️",count:1,mine:true}],"")).toEqual([]);});
 it("does not double count an already confirmed reaction",()=>{expect(withOwnReaction([{emoji:"😂",count:2,mine:true}],"😂")[0].count).toBe(2);});
});
