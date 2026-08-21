#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
文硕阁电子书自动分类脚本
Automatic Classification Script for Wenshuoge Ebooks

基于 CSV 书目自动将电子书分类到不同目录中
Automatically classifies ebooks based on CSV catalog into different directories
"""

import csv
import os
import shutil
from pathlib import Path
from collections import defaultdict
import json


# 书籍分类规则 (Classification Rules)
CLASSIFICATION_RULES = {
    # 古典文学 (Classical Literature)
    "古典文学": [
        "红楼梦", "西游记", "水浒传", "三国演义", "聊斋志异", "搜神记",
        "三言二拍", "拍案惊奇", "儒林外史", "镜花缘", "隋唐演义",
        "说唐", "杨家将", "白蛇传", "牡丹亭", "西厢记", "长生殿",
        "桃花扇", "浮生六记", "呼兰河传", "生死场", "沉沦"
    ],
    
    # 哲学思想 (Philosophy & Thought)
    "哲学思想": [
        "老子", "庄子", "孔子", "孟子", "荀子", "墨子", "鬼谷子",
        "韩非子", "论语", "中庸", "大学", "菜根谭", "颜氏家训",
        "了凡四训", "传习录", "人物志", "论衡", "淮南子"
    ],
    
    # 历史地理 (History & Geography)
    "历史地理": [
        "史记", "汉书", "后汉书", "三国志", "晋书", "宋书",
        "南齐书", "梁书", "陈书", "北史", "南史", "隋书", "旧唐书",
        "新唐书", "旧五代史", "新五代史", "宋史", "辽史", "金史", "元史",
        "明史", "清史", "资治通鉴", "续资治通鉴", "徐霞客游记",
        "水经注", "大唐西域记", "日本国志", "天工开物"
    ],
    
    # 军事兵法 (Military & Strategy)
    "军事兵法": [
        "孙子兵法", "孙膑兵法", "吴子", "司马法", "六韬", "三略",
        "李卫公问对", "武经总要", "百战奇略", "太白阴经", "将苑",
        "兵法二十四篇", "乾坤大略", "尉缭子", "反经", "长短经"
    ],
    
    # 医学养生 (Medicine & Health)
    "医学养生": [
        "黄帝内经", "伤寒论", "金匮要略", "难经", "本草纲目",
        "神农本草经", "千金方", "千金要方", "肘后备急方", "扁鹊心书",
        "食疗本草", "饮膳正要", "针灸大成", "濒湖脉学", "四圣心源",
        "奇经八脉考", "药性歌括"
    ],
    
    # 宗教信仰 (Religion & Belief)
    "宗教信仰": [
        "金刚经", "心经", "六祖坛经", "楞严经", "法华经", "地藏经",
        "华严经", "四十二章经", "黄帝阴符经", "黄庭经", "阴符经",
        "云笈七签", "道德经", "南华经", "文子", "关尹子"
    ],
    
    # 书法篆刻 (Calligraphy & Seal Carving)
    "��法篆刻": [
        "书法", "篆刻", "九成宫", "兰亭", "颜真卿", "米芾",
        "王羲之", "书法论", "篆刻论"
    ],
    
    # 诗词歌赋 (Poetry & Verse)
    "诗词歌赋": [
        "唐诗", "宋词", "楚辞", "诗经", "赋", "诗话", "词话",
        "诗格", "诗品", "词源", "龙吟集", "花间集"
    ],
    
    # 戏曲小说 (Drama & Fiction)
    "戏曲小说": [
        "杂剧", "传奇", "戏文", "话本", "小说", "俚曲"
    ],
    
    # 笔记杂记 (Notes & Miscellaneous)
    "笔记杂记": [
        "笔记", "杂记", "笔谈", "逸事", "闻见", "琐记",
        "病榻杂记", "闲情偶寄", "幽梦影", "小窗幽记", "围炉夜话"
    ],
    
    # 家庭教育 (Family & Education)
    "家庭教育": [
        "家书", "家训", "家规", "弟子规", "三字经", "百家姓",
        "千字文", "幼学琼林", "增广贤文", "名贤集", "朱子家训",
        "颜氏家训", "曾国藩家书"
    ],
    
    # 科学技术 (Science & Technology)
    "科学技术": [
        "九章算术", "算术", "数学", "几何", "代数", "物理",
        "化学", "天文", "天工开物", "农业", "纺织"
    ],
    
    # 法律制度 (Law & Administration)
    "法律制度": [
        "律", "令", "法", "制度", "洗冤集录", "折狱龟鉴",
        "刑法", "民法", "商法"
    ],
    
    # 现代文学 (Modern Literature)
    "现代文学": [
        "鲁迅", "茅盾", "老舍", "张恨水", "徐志摩", "闻一多",
        "郁达夫", "赵树理", "萧红", "丁玲", "巴金", "曹禺"
    ],
    
    # 翻译文学 (Translated Literature)
    "翻译文学": [
        "莎士比亚", "巴尔扎克", "托尔斯泰", "陀思妥耶夫斯基",
        "雨果", "大仲马", "小仲马", "泰戈尔", "欧亨利", "契诃夫"
    ]
}


class EbookClassifier:
    """电子书分类器"""
    
    def __init__(self, csv_file, source_dir="ebookfiles", output_dir="ebookfiles_organized"):
        self.csv_file = csv_file
        self.source_dir = source_dir
        self.output_dir = output_dir
        self.classification_map = {}
        self.unclassified = []
        
    def load_csv_metadata(self):
        """从 CSV 加载书籍元数据"""
        print(f"📖 正在加载书籍元数据: {self.csv_file}")
        
        with open(self.csv_file, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                book_id = row.get('编号', '').strip()
                title = row.get('书名', '').strip()
                subtitle = row.get('副标题', '').strip()
                introduction = row.get('简介', '')[:100]  # 前100字
                
                if book_id:
                    self.classification_map[book_id] = {
                        'title': title,
                        'subtitle': subtitle,
                        'intro': introduction,
                        'category': self._classify_book(title, subtitle, introduction)
                    }
        
        print(f"✅ 已加载 {len(self.classification_map)} 本书的信息")
        return self.classification_map
    
    def _classify_book(self, title, subtitle, introduction):
        """根据书名、副标题和简介分类书籍"""
        text = f"{title} {subtitle} {introduction}".lower()
        
        for category, keywords in CLASSIFICATION_RULES.items():
            for keyword in keywords:
                if keyword.lower() in text:
                    return category
        
        return "其他"  # Default category
    
    def organize_ebooks(self):
        """组织电子书到分类目录"""
        print(f"\n📂 开始组织电子书...")
        
        # 加载元数据
        self.load_csv_metadata()
        
        # 创建输出目录结构
        os.makedirs(self.output_dir, exist_ok=True)
        
        # 按分类创建符号链接或复制文件
        organized_count = 0
        unorganized_count = 0
        
        source_path = Path(self.source_dir)
        
        for item in sorted(source_path.iterdir()):
            if item.is_dir():
                book_id = item.name
                
                if book_id in self.classification_map:
                    book_info = self.classification_map[book_id]
                    category = book_info['category']
                    title = book_info['title']
                else:
                    category = "未分类"
                    title = book_id
                    self.unclassified.append(book_id)
                
                # 创建分类目录
                category_path = Path(self.output_dir) / category
                category_path.mkdir(parents=True, exist_ok=True)
                
                # 目标路径
                dest_path = category_path / f"{book_id}_{title[:20]}"
                
                if not dest_path.exists():
                    try:
                        # 尝试创建符号链接（如果系统支持）
                        os.symlink(item.absolute(), dest_path)
                        organized_count += 1
                        print(f"  ✓ {book_id}: {title} → {category}")
                    except (OSError, NotImplementedError):
                        # 如果不支持符号链接，复制文件夹
                        shutil.copytree(item, dest_path)
                        organized_count += 1
                else:
                    print(f"  ⚠ 已存在: {dest_path.name}")
        
        print(f"\n📊 分类完成:")
        print(f"  已分类: {organized_count}")
        print(f"  未分类: {len(self.unclassified)}")
        
        # 生成报告
        self._generate_report()
    
    def _generate_report(self):
        """生成分类报告"""
        report_path = Path(self.output_dir) / "分类报告.json"
        
        category_stats = defaultdict(int)
        for book_info in self.classification_map.values():
            category_stats[book_info['category']] += 1
        
        report = {
            "总书数": len(self.classification_map),
            "分类数": len(category_stats),
            "未分类": len(self.unclassified),
            "分类统计": dict(sorted(category_stats.items(), key=lambda x: x[1], reverse=True)),
            "未分类书籍": self.unclassified
        }
        
        with open(report_path, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        
        print(f"\n📈 报告已保存: {report_path}")
        print("\n📊 分类统计:")
        for category, count in sorted(category_stats.items(), key=lambda x: x[1], reverse=True):
            print(f"  {category}: {count} 本")


def main():
    """主函数"""
    import sys
    
    csv_file = "文硕阁公版书目录.csv"
    
    if not os.path.exists(csv_file):
        print(f"❌ 错误: 找不到文件 {csv_file}")
        print("请将 CSV 文件放在当前目录中")
        sys.exit(1)
    
    classifier = EbookClassifier(csv_file)
    classifier.organize_ebooks()


if __name__ == "__main__":
    main()
