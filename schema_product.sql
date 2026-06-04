-- WhatsApp Bot Database Schema with YOUR Products
-- Auto-generated from Product_Database.xlsx
-- Total: 268 products

-- Create tables
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  category_id INTEGER REFERENCES categories(id),
  sku VARCHAR(50),
  name VARCHAR(200) NOT NULL,
  chinese_name VARCHAR(200),
  description TEXT,
  unit_size VARCHAR(50),
  image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  total_amount DECIMAL(10, 2),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  product_name VARCHAR(200) NOT NULL,
  unit_size VARCHAR(50),
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(10, 2),
  subtotal DECIMAL(10, 2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- Insert categories
INSERT INTO categories (id, name, description) VALUES (1, 'Bean Products', '14 products');
INSERT INTO categories (id, name, description) VALUES (2, 'Canned Goods', '1 products');
INSERT INTO categories (id, name, description) VALUES (3, 'Dried Goods', '14 products');
INSERT INTO categories (id, name, description) VALUES (4, 'Noodles', '14 products');
INSERT INTO categories (id, name, description) VALUES (5, 'Oils', '8 products');
INSERT INTO categories (id, name, description) VALUES (6, 'Other Products', '84 products');
INSERT INTO categories (id, name, description) VALUES (7, 'Rice & Grains', '21 products');
INSERT INTO categories (id, name, description) VALUES (8, 'Sauces & Condiments', '70 products');
INSERT INTO categories (id, name, description) VALUES (9, 'Seasonings', '19 products');
INSERT INTO categories (id, name, description) VALUES (10, 'Spices', '11 products');
INSERT INTO categories (id, name, description) VALUES (11, 'Spreads & Jams', '5 products');
INSERT INTO categories (id, name, description) VALUES (12, 'Vinegar & Wine', '7 products');

-- Insert products (268 total)

-- Bean Products (14 products)
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (1, 'AA400', 'White Beancurd Preserved', '大石腐乳罐', '300G/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (1, 'AA418', 'Small-Red Beancurd /Lam Joo', '南乳红', '250GM/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (1, 'BB-PKT', 'Black Bean', '黑豆包', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (1, 'BN01', 'Bean Curd Stick', '豆支', '1KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (1, 'BN02', 'Fried Bean Curd Stick', '炸条腐竹', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (1, 'BN03', 'Square-Fried Bean Curd', '炸切腐竹方）', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (1, 'BN06', 'Unsalted Bean Curd Skin', '淡豆皮片包', '', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (1, 'BN08', '######### / # -Salted Bean Curd Skin', '片包咸豆皮', '', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (1, 'BN09', '########Per Soybean Roll', '香铃卷', '180GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (1, 'BN11', 'China Dried Bean Curd Stick Kg', '中国腐竹', '', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (1, 'BN40-片', 'Salted Bean Curd Skin', '片咸豆皮', '', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (1, 'BN606', 'Dried Bean Curd', '小条腐竹', '100GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (1, 'BSB(XG)', 'Sang Kee Black Soy Bean(Xg', '盒仙姑豆豉王', '300G/BOX', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (1, 'SBSB-CAN', 'Black Fermented Dried Bean', '罐黑咸豆豉', '2KG', true);

-- Canned Goods (1 products)
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (2, 'DF803(PKT)', 'Candlenut-Buah Keras', '包峇角力肉', '1KG', true);

-- Dried Goods (14 products)
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (3, 'BF01(PKT)', 'Black Fungus(Small)', '小云耳', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (3, 'BMRS-CAN', 'Mushroom Sliced(Big)', '蘑菇片大罐', '1X2840G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (3, 'CA43(CAN)', 'Pork Leg W/Mushrooms', '香菇猪脚腿罐', '397G/CAN', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (3, 'CA45(CAN)', 'Mushroom Sliced(Small) ( )', '蘑菇片小罐', '425G/CAN', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (3, 'CA51(CAN)', 'Straw Mushroom Sliced ( )', '草菇片罐', '425G/CAN', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (3, 'DGG-PKT', 'Dried Garlic Granules', '包干蒜米粒', '1KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (3, 'DMR-1KG', 'Dried Mushroom( -4Cm)', '干香菇', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (3, 'IBM-02', 'A4 Dried Ikan Bilis Meat', '江鱼肉', '1X1KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (3, 'IBSP-PKT', 'Big Ikan Bilis(Soup) ( )', '大江鱼包熬汤', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (3, 'KIBP-PKT', 'Knorr Ikan Bilis Powder( )', '江鱼仔粉包', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (3, 'PV23', 'A6 Dried Squid', '鱿鱼', '500GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (3, 'SW-PC', 'Seaweed/Dried Laver', '紫菜片', '1X50G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (3, 'Z105', 'Mergui Dried Fish', '包咸鱼午鱼', '500G/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (3, 'Z108(PKT)', 'Dried Sole Fillet(Tai Di Yu)', '包台地鱼肉', '600GM', true);

-- Noodles (14 products)
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (4, 'DG-516', 'Noodle Sauce', '', '1KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (4, 'N41', 'Vermicelli', '冬粉包', '250G/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (4, 'N42', 'Tai Sun Mee Sua', '太山面线包', '3KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (4, 'N43', 'Chai Kee Po Chai Mee( )/ 220Gx30', '箱', '', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (4, 'N45', '########Amoy Flour Vermicelli', '', '300GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (4, 'N60F', 'Ee Mian(Fine)', '伊面幼', '6KG/CTN', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (4, 'N61', 'Yee Fu Noodles', '伊府面', '4KG/CTN', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (4, 'N64', 'Mama Tom Yum Noodle 10Sx18X55G', '', '', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (4, 'N66', 'Ee Mee', '伊面幼', '3KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (4, 'N68', 'Hong Kong Noodle', '箱香港面', '10KG/CTN', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (4, 'N69', 'Crispy Noodle 70Gx36Pkt', '煮炒炸生面', '', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (4, 'N74', 'Tai Lok Mee', '吉隆坡大条面', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (4, 'N84', 'Thick Noodle (Yellow)', '大粗麺', '1KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (4, 'N90', 'Cut Bean Vermicelli', '箱冬粉', '5KG/CTN', true);

-- Oils (8 products)
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (5, 'OIL 28', 'Daisy Vegetable Oil', '', '15KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (5, 'OIL 82', 'Sesame Oil G1 (Red Cap)', '头车蔴油', '5L', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (5, 'OIL 83', 'Sh Seasame Oil (White Cap) ( )', '蔴油白盖', '5LT/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (5, 'OIL 84', 'Ohh Sesame Oil', '胡發興蔴油', '750ML', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (5, 'OIL 88', '########Sh Sesame Oil', '蔴油', '2L', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (5, 'OIL-5L', 'Liter-Cooking Oil', '食油', '', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (5, 'OLVG-CAN', 'Olive Vegetable', '橄榄菜', '450G/CAN', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (5, 'PORICE-25', '( )Ponni Rice Steam Boiled', '袋', '25KG/BAG', true);

-- Other Products (84 products)
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'AA401', 'Dong Cai', '冬菜包', '600GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'AA403', 'Thai Lime Juice', '酸柑水瓶', '1LT/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'AA404', 'Boxthon Fruit/Gou Qi Zi', '枸杞子包', '1X500G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'AA413', 'Marmite Yeast Extract', '妈蜜发酵精华瓶', '410GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'AA415', 'Cai Pu (Sweet)', '菜脯甜包', '1X3KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'AA416', 'Mei Cai Sweet', '梅菜甜包', '1X3KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'AA422', 'Assam Skin', '亚叁皮包', '500GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'AA427(BOT)', 'Coffee Emulco', '咖啡香精瓶', '26G/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'ALMD-NUT', 'Almond Nut', '杏仁坚果', '1X1KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'BA-TMR', 'Baba''S Turmeric Powder', '黄姜粉', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'BA11', 'Baba Coriander Powder', '', '250G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'BA15', 'Baba Cumin Powder', '', '250G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'BLC01(PCS)', 'Belachan', '峇拉煎片', '1X500G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'BN07', '#NAME?', '炸豆支碎', '1KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'BN14', 'Cut-Vegetarian Crispy Soy ·', '香脆豆片', '', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'BOX_KA_L', 'Kara Coconut Milk(L)', '包大椰浆', '1L/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'BP-CAN', 'Braised Peanuts', '香焖花生罐', '1X850G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'CA46(CAN)', 'Highway Pork Luncheon Meat', '猪午餐肉罐', '397GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'CA48', 'Maling Pork Luncheon Meat 397Gx24', '猪午餐肉箱', '', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'CA52(CAN)', 'Mackerel In Tomato Suace', '马鲛鱼罐', '1X425G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'CARN-CAN', 'Carnation Milk (Thai)', '三花淡奶精泰罐', '405GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'CEFC-CAN', 'F/Cream)Carnation Evap', '咖喱鱼头全脂淡奶', '1X390G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'CHO-SYRUP', '( )( - ) Hershey''S Chocolate Syrup', '瓶朱古力精', '680G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'CIN-BOT', 'Cincalok', '瓶真加洛', '300GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'CM01', 'Ginseng', '人参须', '500G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'CM04', 'Dang Gui Sliced', '当归片包', '250G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'CM11', 'Southern Almond', '南杏', '1X500G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'CM12', 'Northern Almond', '北杏', '1X500G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'CRBP-CAN', 'Crescent Baking Powder', '发粉罐', '1X6LBS', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'CS-NUT', 'Cashew Nut', '包腰豆', '', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'CUM-1K', '############Cumin Powder(Pattu)', '', '1KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'DF800(PKT)', '( )Red Dates S/Less', '包无核鸡心枣', '500GM/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'DS01(PKT)', 'Medium Size Shrimp', '虾米中', '1X1KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'DS02(PKT)', 'Pearl Shrimp', '珍珠虾米', '1X1KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'DSS01(PKT)', 'Shrimp Skin', '虾苗扣', '1X500G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'FGH-PKT', 'Pattu_Fried Gram Dhall', '', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'FL07(CAN)', 'Royal Baking Powder', '罐发粉', '450G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'FL08(BAG)', 'Custard Powder', '袋蛋黄粉', '300G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'FL11(PKT)', 'Wild Ginger Powder', '砂姜粉', '500GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'FL12(TUB)', '( )Orange Red', '罐柑红粉', '450G/TUB', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'FL13(PKT)', 'Santan Coconut Milk Powder', '包椰粉', '50G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'FNOS-BOT', 'F&N Orange Squash', '桶', '2L', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'FRON-PKT', 'Fried Onion / (Bawang Goreng', '包炸小葱', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'FZ-606', 'Prawn Roll', '虾枣', '1KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'FZ610', 'Prawn Roll Sample', '虾枣', '', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'FZ8', 'Yam Ring', '炸芋头圈 (佛钵)', '250GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'GCLQ-BOT', '( )Green Colour Liquid', '罐青色素', '500ML', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'GPN-PWD', 'Grounded Peanut Powder', '包花生碎', '2KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'KA-L', 'Kara Coconut Milk(L)', '包大椰浆', '1L/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'KA-M', 'Kara Coconut Milk(M)', '包中椰浆', '500ML/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'L001(BOT)', 'Pearl River Bridge (Sang Chow Wang', '珠江生抽王', '', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'LQMTZ', 'Bird King Liquid Meat Tenderlizer( )', '液体嫩肉剂瓶', '1X4OZ', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'LYC_CTN', 'Narcissus Lychees In Syrup', '', '567GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'M503', 'Lye Water ( )', '枧水桶', '5L/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'MAG-BOT', 'Maggi Conc.Chicken Stock', '美极鲜汤瓶', '1.2KG/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'MALT-CAN', 'Maltose', '麦芽糖罐', '500G/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'MAYO-TUB', 'Mayonnaise', '美乃滋酱桶', '3L/TUB', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'MUS-PKT', 'Mustard Seed(Biji Sawi)', '包', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'N67', 'Bee Hoon', '包米粉干', '3KGPKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'NEST-PKT', 'Nestum Cereal', '包麦片', '1KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'OIL 22', 'Pork Lard', '二爷猪油', '4KG/TUB', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'P-NUT(M)', 'Raw Peanut', '包花生', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'PBC-TUB', 'Skippy Peanut Butter Creamy', '花生酱桶', '1X1KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'PKL-罐', 'Pickled Lettuce', '香菜心', '1X182G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'PLT-TIN', 'Planta', '牛油', '', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'PV1', 'Luo Han Guo 10Pc/ (Monk''S Fruit', '罗汉果', '', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'PV19', 'Africa Toordall (Pattu)', '', '5KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'PV22', 'Sodium Bicarbonate', '', '100G BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'PV29', 'Chu Zhen Fish Gravy', '厨珍壹等鱼露', '750GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'PV30', 'Gula Kelapa- Melaka (', '椰糖', '10KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'PV4', 'Tangerine Peel(Young)', '果皮', '1X500GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'QQ11', 'Jia Shai', '加晒', '5KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'SAF-YST', 'Instant Yeast', '即发酵母', '500G/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'SAUS-PKT', 'Standard Red Sausage', '炭烘红肠', '500GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'SIB-PKT', 'Premium Baby Silver Fish', '银鱼', '1KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'SQLM-BOT', 'Sunquick Lemon', '浓缩柠檬汁', '1X840ML', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'SQOR-BOT', 'Sunquick Orange', '浓缩甜橙汁', '1X840ML', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'TOM-BOT', 'Por Kwan Tom Yam', '罐冬炎酸辣香酱料', '900G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'W004', 'F&N Cordial Rose', '', '2L', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'XI606', 'Bread Crumb (White)', '面包糠白', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'YS01', '( ) Melon Strip', '桶瓜英絲', '1X2KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'YS05', '( ) Whtie Sour Ginger Slice', '桶白姜絲', '1X2KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'YS30', 'Posters', '', '', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (6, 'Z106', 'Fish Maw', '包鱼鳔', '500G/PKT', true);

-- Rice & Grains (21 products)
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (7, 'BK-SRFL', 'Blue Key S/Raising Flour', '自发面粉盒', '1KG/BOX', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (7, 'FL02', 'Glutinous Rice Flour', '糯米粉', '1X600G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (7, 'FL03(PKT)', 'Plain Flour', '面粉', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (7, 'FL04', 'Fry Chicken Flour', '包炸鸡粉', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (7, 'FL06(PKT)', 'Rice Flour', '包粘米粉', '600G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (7, 'FL14', 'Potato Starch', '风车粉', '2KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (7, 'FL15', 'Red Medal Potato Starch', '风生粉', '25KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (7, 'FL400', 'Corn Starch', '包玉米淀粉', '400G/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (7, 'FL500', 'Best Tapioca Starch', '包金飞人大茨粉', '500G/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (7, 'FL600', '( ) Wheat Starch(Deng Flour)', '包澄面粉', '500G/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (7, 'GHFL-1K', 'Besan (Chick Pea) Yellow Dhall Flour', '', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (7, 'M522(BOT)', 'Rice Vinegar', '白米醋瓶', '600ML/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (7, 'M528(BOT)', 'Rice Cooking Wine ( )', '白米酒大厨瓶', '640ML/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (7, 'M538(BOT)', 'Bulldog Black Rice Vinegar(P)', '', '1X750ML', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (7, 'N75', 'Tai Sun Brown Rice Bee Hoon', '', '', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (7, 'R204', 'Royal Umbrella Rice(Premium) ( )', '安培娜泰国香米袋', '25KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (7, 'RC(LOAN)', 'Rice Container(', '米缸', '', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (7, 'TMPF/包', 'Tempura Flour', '炸脆粉', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (7, 'WFFF-25KG', '( )Wheat Flour (Swordfish)', '袋面粉', '25KG/BAG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (7, 'WMPS-05', 'Windmill Potato Starch', '风车超级生粉', '5KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (7, 'WMPS-25', 'Windmill Potato Starch (', '风车超级生粉', '25KG/BAG', true);

-- Sauces & Condiments (70 products)
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'AA417', 'Assam Paste/Tamarind', '亚叁膏包', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'ABC-SWS', 'Abc Sweet Sauce', '甜酱油瓶', '1X620ML', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'BA10', 'Baba''S Meat Curry Pwd', '肉咖喱粉', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'BA12', 'Baba''S Chilli Powder', '辣椒粉', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'BA14(PKT)', 'Baba Fish Curry Pwd', '鱼咖喱粉', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'C02', 'Thailand Sweet Chilli Sauce', '泰式甜辣椒酱', '5KG/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'C03', 'Thailand Sweet Chilli Sauce', '泰式甜辣椒瓶', '980G/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'C07', 'Dried Chilli', '辣椒干包', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'C08', 'Green Chilli W/Vinegar )', '调味青椒包', '3KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'C09', 'Sambal Chilli ( )', '叁峇辣椒包', '3KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'C10', 'Chilli Paste', '粗辣椒包', '3KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'C12', 'Sweet Chilli Sauce ( )', '甜辣椒酱桶', '5L/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'C14', 'Hot Bean Paste', '豆瓣酱', '6KG/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'C15-1K', 'Crushed Chilli - Pattu', '包', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'C19', 'Scw Mala Spicy Chilli', '麻辣辣椒酱', '1X5L', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'C22', 'Yellow Cap- Grind Soya Beans', '黄盖磨豉', '620G/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'C23', 'Yellow-Salted Soya Paste', '包磨豆酱黄', '3KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'C24', 'Black-Salted Soya Paste', '包碎豆酱黑', '3KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'C41', 'Erye_Belachan Chilli', '二爷峇拉煎辣椒', '1KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'CGCP-BOT', '( )Waugh''S Curry Powder', '瓶双枪咖喱粉', '', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'D400(BOT)', '( ) Kim Lan Soy Paste', '瓶金蘭油膏', '590ML', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'D403(BOT)', '( ) Kim Lan Soy Sauce', '瓶金蘭酱油', '590ML', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'DG-501', 'Sample Fish Curry Sauce Tg', '咖喱鱼酱', '1X1KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'DG-508', 'Assam Chilli Sauce', '亚参辣酱', '1X1KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'DG-512', 'Belachan Chilli(Dipping)', '峇拉煎辣椒外用', '1X1KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'FSHRS-BOT', 'Shrimp Sauce(Ship', '罐幼滑虾酱', '227G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'L003(GREEN CAP)', 'Light Soya Sauce(Green)- ( )', '生抽青盖', '5L', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'L005', 'Light Soya Sauce (Standard)', '生抽', '5L/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'LK01(BOT)', 'Kikkoman Soya Sauce ( )', '萬字酱清瓶', '1.6L/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'LKK1(BOT)', 'Fine Shrimp Sauce(Lee Kum Kee)', '虾酱罐', '227G/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'LKK2(BOT)', 'Lea & Perrins Sauce L&P ( )', '酱瓶', '290ML/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'LKK3(BOT)', 'Hp Sauce Hp ( )', '酱瓶', '255GM/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'LKK4(BOT)', 'A1 Sauce A1', '酱瓶', '240GM/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'LKK5(BOT)', 'Tiparos Fish Sauce 700Cc', '鱼味露瓶', '', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'M502(CAN)', '3A Hot Broad Bean Paste(S) ( )', '辣豆板酱罐', '180G/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'M504(BOT)', 'Tangerine Sauce ( )', '金桔油瓶', '350GM/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'MCMDS-110', 'Golden Dark Soy Sauce', '金黄生晒桶', '', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'MCMLS-110', '9 Star Light Soya Sauce', '9星 豉油头', '4KG/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'MCMLS-410', '4 Star Light Soya Sauce', '4星 豉油头', '3.6KG/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'MF2', 'Habhal Red Sauce', '', '645ML BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'MWBLC-PKT', 'Seafood Belacan Paste', '海鲜马来栈', '1KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'MWCFP-PKT', 'Curry Fish Head Paste', '咖哩鱼头酱料', '1KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'MWXO/包', 'Seafood XO Paste', '海鲜酱', '1KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'OKFS/瓶', 'Ok Fruity Sauce Ok', '甜酸调味酱', '1X335G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'OYS-LKK', 'Panda Brand Oyster Sauce', '熊猫牌鲜味蚝油', '2.2KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'OYS-SH', 'Sh Oyster Sauce', '蚝油', '5L/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'OYS21', 'Oyster Sauce (Premium)', '蠔油', '5LT/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'OYS23', 'Oyster Sauce (Standard)', '蠔油', '5LT/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'PMBP-CAN', 'Pork Minced W/Bean Paste', '香菇肉酱罐', '1X185G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'PV14', 'Yellow Soya Bean', '黄豆包', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'QQ16', 'Red Dark Soya Sauce', '红加晒', '5KG/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'QQ18', 'Red Fragrant Dark Soya Sauce', '香老抽红', '5KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'S709', 'Maggi Chilli Sauce', '美极辣椒酱', '3.3KG/TIN', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'S710', 'Hoisin Sauce', '海鲜酱', '5L/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'S713', 'Maggi Tomato Sauce', '美极蕃茄酱', '3.3KG/TIN', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'S714', 'Lemon Paste', '柠檬酱', '6KG/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'S716', 'Tomato Sauce', '茄汁', '4L/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'S719', 'Plum Paste', '梅膏', '6KG/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'SFS-2L', 'Sweet Flour Sauce(Chh)', '甜酱', '1X2L', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'SHP-CAN', 'Kk Shrimp Paste', '虾膏', '1X227G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'SMP-01', 'Belacan Chilli Sampling Only', '', '500GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'SMP-11', 'Nonya Sauce', '娘惹酱包', '400GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'SMP03', 'Top Sambal Chilli Sampling', '', '500GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'SMP04', 'Erye Fish Curry Paste Sampling', '', '500GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'SMP12', 'Mcml- -Star Light Soy Sauce', '豉油', '', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'TOM-TIN', '( )( ) Chilli In Oil For Tom Yum', '珍冬炎酱', '3KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'TS-10', 'Yam Paste', '芋泥包', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'TSCP/包', 'Tungsan Chilli Paste', '唐山正辣椒酱', '3KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'TSSP/桶', 'Tungsan Sesame Paste', '唐山芝麻酱', '1X2.5KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (8, 'YM600', 'Yam Paste With Ginko Nut', '', '600GM', true);

-- Seasonings (19 products)
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (9, 'AA424(PKT)', 'Mei Cai (Salted)', '梅菜咸包', '3KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (9, 'BBFC-CAN', 'Fried Dace W Salted B/Bn', '豆豉鲮鱼罐头', '1X184G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (9, 'BPT-PKT', 'Rock Sugar Slab', '冰片糖', '1X400G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (9, 'GK02', 'Ctn_ 2P Coconut Sugar (', '箱椰糖', '20X500GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (9, 'KMTZ-BOT', 'Knorr Meat Marinates Seasoning', '醃粉调味料瓶', '454GM/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (9, 'M18', 'Ajinomoto(Ajinex)', '味精', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (9, 'M506', 'G/S Salted Mei Kuei Lu', '玫瑰露厨用瓶', '1X750ML', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (9, 'M508', 'Fine Sugar', '白糖袋', '25KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (9, 'M512', 'Rock Sugar ( )', '冰糖包', '3KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (9, 'M532', 'Salt ( )', '盐包', '3KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (9, 'M534', ': Sugar', '白糖包', '1KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (9, 'M59(PKT)', 'Ve-Sin Msg', '味精包', '1KG/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (9, 'MXSF-CAN', 'Mei Xiang Salted Fish', '梅香咸鱼罐', '400GM/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (9, 'PV10', 'Table Salt', '盒盐盒', '500G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (9, 'PV11', 'Salted Plum', '罐咸水梅', '2KG/TUB', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (9, 'PV18(BOT)', 'Maggi Seasoning (', '美极鲜味汁', '800ML', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (9, 'PV7(PKT)', 'Knorr Chicken Flavored Seasoning', '袋', '1KG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (9, 'VE-SIN25', 'Ve-Sin Msg', '味精粒袋', '25KG/BAG', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (9, 'Z100(PKT)', 'Salted Fish Bits', '咸鱼粒包', '1X1KG', true);

-- Spices (11 products)
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (10, 'BA18', 'Baba Briyani Spice', '', '250GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (10, 'C01(PKT)', 'Cinnamon Skin ( )', '桂皮包', '250GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (10, 'CLV-PKT', 'Clove Seeds ( )', '丁香籽包', '250GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (10, 'DF802(PKT)', 'Star Aniseed', '八角', '250GM/PKT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (10, 'FL10(PKT)', 'Five Spices Powder', '包五香粉', '500G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (10, 'M514-PKT(包)', 'Black Pepper(Coarse)', '粗黑胡椒', '500G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (10, 'M515', 'White Pepper Mix Pwd', '白胡椒粉包', '400GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (10, 'M519', 'White Pepper(Coarse)', '白胡椒碎包', '500GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (10, 'RYML', 'Rui Yuan Mala Spicy Spices', '瑞远麻辣拌料', '1X750G', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (10, 'YS14', 'White Pepper Powder(', '胡椒粉包', '', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (10, 'YS15', 'Cinnamon Powder(', '桂末粉包', '', true);

-- Spreads & Jams (5 products)
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (11, 'AA409', 'Pineapple Jam', '凤梨果酱罐', '1X450GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (11, 'AA410', 'Apple Jam', '蘋果果酱罐', '1X450GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (11, 'AA412', 'Honey', '蜜糖瓶', '1KG/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (11, 'HD/包', 'Honey Dates', '蜜枣', '500GM', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (11, 'HSC-CAN', 'Honey Sea Coconut', '蜂蜜海底椰', '565GM', true);

-- Vinegar & Wine (7 products)
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (12, 'HTW-GAL', 'Hua Tiao Wine(Great Chef)', '花雕酒大厨', '3.75LT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (12, 'M505(BOT)', 'Pagoda Chinese Cooking Wine ( )', '塔标烹饪酒瓶', '640ML/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (12, 'M510', 'White Vinegar', '白醋', '5L/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (12, 'M521', 'Hua Tiao Chiew(Gt Chef)', '花雕酒大厨瓶', '640ML/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (12, 'M524', 'Plum Blossom Hua Tiao Chiew', '大梅花花彫酒', '500ML/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (12, 'M525(BOT)', 'Chin Kiang Vinegar(Yellow Label)', '香醋', '550ML/BOT', true);
INSERT INTO products (category_id, sku, name, chinese_name, unit_size, is_active) VALUES (12, 'M527(BOT)', 'Gw Black Vinegar', '长城黑浙醋瓶', '635ML/BOT', true);
