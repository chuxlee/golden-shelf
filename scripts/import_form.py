#!/usr/bin/env python3
"""Импорт ответов Яндекс Форм в Jekyll. Python 3.9+, без зависимостей."""
import argparse
import json
import re
from pathlib import Path


def field(row, prefix):
    return next((str(v or '').strip() for k, v in row.items()
                 if k.strip().startswith(prefix)), '')


def split_items(value, count=None):
    if not value:
        return []
    blocks = re.split(r'\n[ \t]*\n+', value.strip())
    lines = [s.strip() for s in value.splitlines() if s.strip()]
    if count == 1:
        return [value.strip()]
    if count is None:
        return blocks if len(blocks) > 1 else lines
    if len(blocks) == count:
        return [s.strip() for s in blocks]
    if len(lines) == count:
        return lines
    return blocks


def quote(value):
    # JSON-строка также является корректной строкой YAML.
    return json.dumps(value, ensure_ascii=False)


def document(fields, body):
    header = '\n'.join(f'{k}: {quote(v)}' for k, v in fields.items())
    return f'---\n{header}\n---\n\n{body.strip()}\n'


def write(path, content, overwrite):
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open('w' if overwrite else 'x', encoding='utf-8') as f:
            f.write(content)
    except FileExistsError:
        print(f'  ПРОПУСК: {path} уже существует')
        return False
    print(f'  Создан: {path}')
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('json_file', type=Path)
    parser.add_argument('--root', type=Path, default=Path.cwd(), help='Корень Jekyll')
    parser.add_argument('--overwrite', action='store_true', help='Разрешить перезапись MD')
    parser.add_argument('--portrait-ext', default='png', choices=['png','jpg','jpeg','webp'])
    parser.add_argument('--cover-ext', default='jpg', choices=['png','jpg','jpeg','webp'])
    args = parser.parse_args()
    data = json.loads(args.json_file.read_text(encoding='utf-8-sig'))
    if not isinstance(data, list):
        parser.error('Ожидается массив ответов формы')
    seen = set()
    authors = books = warnings = 0
    for raw in data:
        try:
            row = dict(raw)
        except (ValueError, TypeError):
            print('ОШИБКА: некорректная строка формы'); warnings += 1; continue
        slug = field(row, 'Фамилия преподавателя латинскими буквами').lower()
        name = field(row, 'ФИО преподавателя')
        if not re.fullmatch(r'[a-z][a-z0-9_-]*', slug) or not name or slug in seen:
            print(f'ОШИБКА: пустое ФИО, неверный или повторный author_id: {slug!r}, {name}'); warnings += 1; continue
        seen.add(slug)
        print(f'\n{name} ({slug})')
        titles = split_items(field(row, 'Названия книг'))
        desc = split_items(field(row, 'Библиографическое описание книг'), len(titles))
        notes = split_items(field(row, 'Анотации к книгам') or field(row, 'Аннотации к книгам'), len(titles))
        # Не сопоставляем неоднозначные списки по догадке.
        valid = all(not items or len(items) == len(titles) for items in (desc, notes))
        if not valid:
            print(f'  ВНИМАНИЕ: названий {len(titles)}, описаний {len(desc)}, аннотаций {len(notes)}. Книги пропущены.'); warnings += 1
        image_dir = args.root / 'assets' / 'images' / 'persons' / slug
        image_dir.mkdir(parents=True, exist_ok=True)
        base = f'/assets/images/persons/{slug}'
        biography = field(row, 'Биография, образование')
        if not biography:
            print('  ВНИМАНИЕ: нет текста биографии'); warnings += 1
        fields = dict(title=name, name=name, author_id=slug,
                      degree='', science_field='', photo=f'{base}/portrait.{args.portrait_ext}',
                      bio_short=field(row, 'Краткая биография'), media=[], bibliography=[])
        authors += write(args.root / '_persons' / f'{slug}.md', document(fields, biography), args.overwrite)
        if not valid:
            continue
        for i, title in enumerate(titles, 1):
            fields = dict(title=title, author_id=slug, cover=f'{base}/book{i}.{args.cover_ext}')
            body = '## Библиографическое описание\n\n' + (desc[i-1] if desc else '')
            body += '\n\n## Аннотация\n\n' + (notes[i-1] if notes else '')
            books += write(args.root / '_works' / f'{slug}{i}.md', document(fields, body), args.overwrite)
        if titles and (not desc or not notes):
            print('  ВНИМАНИЕ: отсутствуют описания или аннотации; разделы оставлены пустыми'); warnings += 1
    print(f'\nСоздано: преподавателей {authors}, книг {books}. Предупреждений: {warnings}.')


if __name__ == '__main__':
    main()
