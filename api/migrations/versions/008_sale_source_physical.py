"""update old sales to physical source

Revision ID: 008
Revises: 007
Create Date: 2026-09-25 19:45:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import json


revision: str = '008'
down_revision: Union[str, None] = '007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    products = conn.execute(sa.text("SELECT id, sale_history, sold_sizes FROM products")).fetchall()
    for pid, sale_history, sold_sizes in products:
        changed = False
        
        sh_list = sale_history if isinstance(sale_history, list) else (json.loads(sale_history) if sale_history else [])
        new_sh = []
        for sh in sh_list:
            if not sh.get("source") or sh.get("source") == "manual":
                sh["source"] = "physical"
                changed = True
            new_sh.append(sh)
            
        ss_list = sold_sizes if isinstance(sold_sizes, list) else (json.loads(sold_sizes) if sold_sizes else [])
        new_ss = []
        for ss in ss_list:
            if not ss.get("source") or ss.get("source") == "manual":
                ss["source"] = "physical"
                changed = True
            new_ss.append(ss)
            
        if changed:
            conn.execute(sa.text(
                "UPDATE products SET sale_history = :sh, sold_sizes = :ss WHERE id = :pid"
            ).bindparams(sh=json.dumps(new_sh), ss=json.dumps(new_ss), pid=pid))

def downgrade() -> None:
    pass
