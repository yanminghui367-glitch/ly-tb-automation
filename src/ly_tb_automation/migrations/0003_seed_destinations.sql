INSERT INTO countries
    (country_code, name_zh, name_en, region, timezone, priority, is_enabled, created_at, updated_at)
VALUES
    ('JP', '日本', 'Japan', '亚洲', 'Asia/Tokyo', 10, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('FR', '法国', 'France', '欧洲', 'Europe/Paris', 20, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('VN', '越南', 'Vietnam', '亚洲', 'Asia/Ho_Chi_Minh', 30, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO cities
    (city_code, country_id, name_zh, name_en, slug, is_core_city, priority, is_enabled, created_at, updated_at)
SELECT city_code, countries.id, city_name_zh, city_name_en, slug, is_core_city, seed.priority, 1,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (
    SELECT 'JP-TOKYO' city_code, 'JP' country_code, '东京' city_name_zh, 'Tokyo' city_name_en, 'tokyo' slug, 1 is_core_city, 10 priority UNION ALL
    SELECT 'JP-OSAKA', 'JP', '大阪', 'Osaka', 'osaka', 1, 20 UNION ALL
    SELECT 'JP-KYOTO', 'JP', '京都', 'Kyoto', 'kyoto', 1, 30 UNION ALL
    SELECT 'JP-NAGOYA', 'JP', '名古屋', 'Nagoya', 'nagoya', 0, 40 UNION ALL
    SELECT 'JP-FUKUOKA', 'JP', '福冈', 'Fukuoka', 'fukuoka', 0, 50 UNION ALL
    SELECT 'FR-PARIS', 'FR', '巴黎', 'Paris', 'paris', 1, 10 UNION ALL
    SELECT 'FR-LYON', 'FR', '里昂', 'Lyon', 'lyon', 0, 20 UNION ALL
    SELECT 'FR-NICE', 'FR', '尼斯', 'Nice', 'nice', 0, 30 UNION ALL
    SELECT 'FR-MARSEILLE', 'FR', '马赛', 'Marseille', 'marseille', 0, 40 UNION ALL
    SELECT 'FR-BORDEAUX', 'FR', '波尔多', 'Bordeaux', 'bordeaux', 0, 50 UNION ALL
    SELECT 'VN-HANOI', 'VN', '河内', 'Hanoi', 'hanoi', 1, 10 UNION ALL
    SELECT 'VN-HO-CHI-MINH', 'VN', '胡志明市', 'Ho Chi Minh City', 'ho-chi-minh-city', 1, 20 UNION ALL
    SELECT 'VN-DA-NANG', 'VN', '岘港', 'Da Nang', 'da-nang', 1, 30 UNION ALL
    SELECT 'VN-NHA-TRANG', 'VN', '芽庄', 'Nha Trang', 'nha-trang', 0, 40 UNION ALL
    SELECT 'VN-PHU-QUOC', 'VN', '富国岛', 'Phu Quoc', 'phu-quoc', 0, 50
) seed
JOIN countries ON countries.country_code = seed.country_code;
