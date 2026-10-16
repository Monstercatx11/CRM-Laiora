import 'server-only';
import { cache } from 'react';
import { requireAccount } from './auth';
import { sessionClient } from './supabase/server';
import { businessDate } from './format';
import { defaultSettings,type BusinessSettings,type ChatData,type DataResult,type Order,type Product } from './types';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function databaseError(error:{code?:string;message?:string}|null):string|null {
 if(!error)return null;
 if(['PGRST202','PGRST204','PGRST205','42P01','42883'].includes(error.code??''))return 'Database perlu diperbarui. Jalankan UPGRADE_OPERASIONAL.sql sesuai panduan versi ini.';
 if(error.code==='42501')return 'Akun ini tidak diizinkan melakukan operasi tersebut.';
 if(error.code==='23505')return 'Data sudah ada atau nomor order berbenturan. Muat ulang dan periksa sequence.';
 if(error.code==='40001'||/revision|stale|changed|conflict/i.test(error.message??''))return 'Order telah berubah di sesi lain. Muat ulang halaman sebelum menyimpan.';
 if(/sequence.*(initial|exhaust)|counter/i.test(error.message??''))return 'Atur nomor order terakhir pada Pengaturan sebelum mengonfirmasi PO baru.';
 if(/cancelled|draft|confirmed|payment|date|quantity|price|product|invalid|timezone|cannot|must|required|not found|inactive|too (?:long|many)/i.test(error.message??''))return (error.message??'Data belum valid.').slice(0,250);
 return 'Data belum dapat diproses. Periksa koneksi Supabase dan migrasi database.';
}
async function client(){await requireAccount();return (await sessionClient())!;}
function hydrate(raw:Record<string,unknown>):Order {return {...raw,order_items:raw.order_items??[],payments:raw.payments??[],order_revisions:raw.order_revisions??[]} as unknown as Order;}
export const getSettings=cache(async():Promise<DataResult<BusinessSettings>>=>{const db=await client();const {data,error}=await db.from('app_settings').select('*').eq('singleton',true).maybeSingle();return {data:data?{...defaultSettings,...data}:defaultSettings,error:databaseError(error)};});
export const getCatalog=cache(async():Promise<DataResult<Product[]>>=>{const db=await client();const settings=await getSettings();const today=businessDate(settings.data.timezone);const {data,error}=await db.from('products').select('*,product_prices(*)').order('name');return {data:(data??[]).map(p=>{const prices=(p.product_prices??[]) as {unit_price:number;effective_from:string}[];const price=prices.filter(v=>v.effective_from<=today).sort((a,b)=>b.effective_from.localeCompare(a.effective_from))[0];return {id:p.id,sku:p.sku,name:p.name,size:p.size,active:p.active,unit_price:price?Number(price.unit_price):null};}),error:databaseError(error)||settings.error};});
export type OrderFilters={q?:string;date?:string;state?:string;page?:number;pageSize?:number};
export async function listOrders(filters:OrderFilters={}):Promise<DataResult<{orders:Order[];count:number}>> {const db=await client();const size=Math.min(100,Math.max(1,filters.pageSize||25)),page=Math.min(10000,Math.max(1,filters.page||1));let query=db.from('orders').select('*,order_items(*),payments(*)',{count:'exact'}).order('created_at',{ascending:false});
 if(filters.state&&['draft','confirmed','cancelled'].includes(filters.state))query=query.eq('state',filters.state);
 if(filters.date&&/^\d{4}-\d{2}-\d{2}$/.test(filters.date))query=query.eq('delivery_date',filters.date);
 const q=(filters.q??'').replace(/[^\p{L}\p{N}\s@+_-]/gu,'').slice(0,100).trim();if(q)query=query.or(`order_no.ilike.%${q}%,sender_name.ilike.%${q}%,recipient_name.ilike.%${q}%,sender_phone.ilike.%${q}%,recipient_phone.ilike.%${q}%`);
 const {data,error,count}=await query.range((page-1)*size,page*size-1);return {data:{orders:(data??[]).map(hydrate),count:count??0},error:databaseError(error)};}
export async function getOperationalOrders(filters:{date?:string;state?:string}={}):Promise<DataResult<Order[]>> {const result:Order[]=[];for(let page=1;page<=100;page++){const r=await listOrders({...filters,page,pageSize:100});if(r.error)return {data:[],error:r.error};if(r.data.count>10000)return {data:[],error:'Lebih dari 10.000 order cocok. Pilih tanggal untuk memperkecil rekap.'};result.push(...r.data.orders);if(result.length>=r.data.count)return {data:result,error:null};}return {data:[],error:'Rekap terlalu besar. Persempit tanggal.'};}
export async function getOrder(id:string):Promise<DataResult<Order|null>>{if(!UUID.test(id))return {data:null,error:'ID order tidak valid.'};const db=await client();const {data,error}=await db.from('orders').select('*,order_items(*),payments(*),order_revisions(*)').eq('id',id).maybeSingle();return {data:data?hydrate(data):null,error:databaseError(error)};}
export async function getSequence():Promise<DataResult<{year:number;last_value:number}[]>>{const db=await client();const {data,error}=await db.rpc('laiora_get_sequence');return {data:Array.isArray(data)?data:[],error:databaseError(error)};}
export async function getSyncStatus(){const db=await client();const {data,error}=await db.rpc('laiora_sync_status');return {data:{pending:Number(data?.pending??0),failed:Number(data?.failed??0),lastCompleted:data?.lastCompleted??data?.last_completed??null,configured:data?.configured===true,error:typeof data?.error==='string'?data.error:undefined},error:databaseError(error)};}
export async function getChatData(selectedId?:string):Promise<DataResult<ChatData>> {
 const db=await client();
 const empty:ChatData={conversations:[],messages:[],opportunities:[],allOpportunities:[],selected:null};
 const {data:conversations,error}=await db.from('conversations').select('*,contacts(*)').order('last_message_at',{ascending:false,nullsFirst:false}).limit(200);
 if(error)return {data:empty,error:databaseError(error)};
 const selected=(conversations??[]).find(c=>c.id===selectedId)??conversations?.[0]??null;
 if(!selected)return {data:empty,error:null};
 const [messages,opportunities]=await Promise.all([
  db.from('messages').select('*').eq('conversation_id',selected.id).order('sent_at',{ascending:false}).limit(100),
  db.from('chat_opportunities').select('*,opportunity_product_labels(*),opportunity_order_links(order_id,orders(id,order_no,state))',{count:'exact'}).in('conversation_id',(conversations??[]).map(c=>c.id)).order('created_at',{ascending:false}).limit(5000)
 ]);
 if((opportunities.count??0)>5000)return {data:empty,error:'Lebih dari 5.000 peluang pada daftar chat terbaru. Gunakan rekap atau arsip sebelum memuat daftar ini.'};
 const all=opportunities.data??[];
 return {data:{conversations:conversations??[],selected,messages:(messages.data??[]).reverse(),opportunities:all.filter(o=>o.conversation_id===selected.id),allOpportunities:all} as ChatData,error:databaseError(messages.error||opportunities.error)};
}
export async function getOpportunityDraft(id:string):Promise<DataResult<{sender_name:string;sender_phone:string;raw_form:string}>> {
 const empty={sender_name:'',sender_phone:'',raw_form:''};if(!UUID.test(id))return {data:empty,error:'ID peluang tidak valid.'};const db=await client();
 const opportunity=await db.from('chat_opportunities').select('conversation_id').eq('id',id).maybeSingle();
 if(opportunity.error||!opportunity.data)return {data:empty,error:databaseError(opportunity.error)||'Peluang tidak ditemukan.'};
 const [conversation,messages]=await Promise.all([db.from('conversations').select('*,contacts(*)').eq('id',opportunity.data.conversation_id).maybeSingle(),db.from('messages').select('body').eq('conversation_id',opportunity.data.conversation_id).eq('direction','inbound').eq('message_type','text').order('sent_at',{ascending:false}).limit(20)]);
 const raw=(messages.data??[]).reverse().map(m=>m.body??'').join('\n\n');if(raw.length>50000)return {data:empty,error:'Isi chat terlalu panjang untuk draft. Pilih dan tempel form yang relevan secara manual.'};
 return {data:{sender_name:conversation.data?.contacts?.display_name??'',sender_phone:conversation.data?.contacts?.phone??'',raw_form:raw},error:databaseError(conversation.error||messages.error)};
}
