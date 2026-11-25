# -*- coding: utf-8 -*-
"""One-pager imprimible: puesta en marcha de AgroCore en una sola carilla."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Inicio-1Pagina.pdf")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d"); G600 = colors.HexColor("#16a34a")
G100 = colors.HexColor("#dcfce7"); SLATE = colors.HexColor("#475569")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_num  = S("num", fontName="Helvetica-Bold", fontSize=10, textColor=colors.white, alignment=1, leading=12)
st_tit  = S("tit", fontName="Helvetica-Bold", fontSize=9.6, textColor=G900, leading=11.5)
st_desc = S("desc", fontName="Helvetica", fontSize=8.4, textColor=colors.HexColor("#334155"), leading=10)
st_ruta = S("ruta", fontName="Helvetica-Oblique", fontSize=7.6, textColor=G700, leading=9)

PASOS = [
    ("Ingresar", "Abrí la dirección de tu empresa y entrá con tu usuario y clave.", "https://tuempresa.agrocore.ar/app"),
    ("Empresa", "Nombre, CUIT, IVA y logo. Con ARCA si facturás, o modo sin ARCA si sos informal.", "Administración > Empresas / Configuración"),
    ("Usuarios y roles", "Creá los usuarios y asignales un rol (Admin, Contable, Operaciones, Lectura).", "Administración > Usuarios / Roles y permisos"),
    ("Catálogos", "Revisá cereales, insumos, labores, especies y unidades (ya vienen cargados).", "Administración > Catálogos"),
    ("Categorías y Familias", "El árbol de artículos se arma solo la 1a vez; ajustalo a tu operación.", "Administración > Categorías y Familias"),
    ("Categorías de Gastos", "El árbol de gastos también se arma solo; se usa en Movimientos diarios.", "Administración > Categorías de Gastos"),
    ("Campos y lotes", "Cargá tus campos y, dentro, los lotes con sus hectáreas.", "Producción > Campos y lotes"),
    ("Cajas de efectivo", "Agregá cada caja con su nombre y su saldo inicial de hoy.", "Tesorería > Control de efectivo"),
    ("Bancos y tarjetas", "Nueva cuenta: banco, número, moneda y saldo inicial. Tarjetas en el mismo lugar.", "Tesorería > Bancos"),
    ("Cotizaciones", "Si usás dólares o kg novillo, revisá la tabla (se actualiza sola).", "Tesorería > Cotizaciones"),
    ("Clientes y proveedores", "Cargalos acá o al vuelo mientras hacés una venta o compra.", "Ventas > Clientes  ·  Compras > Proveedores"),
    ("Empleados", "Si llevás sueldos, cargá tu personal (planilla por mes, día o jornal).", "RRHH > Empleados"),
    ("Stock inicial", "Cargá las existencias con las que arrancás y... ¡a operar!", "Stock > Movimientos"),
]

def header_footer(canvas, doc):
    canvas.saveState(); w, h = A4
    canvas.setFillColor(G900); canvas.rect(0, h-18*mm, w, 18*mm, fill=1, stroke=0)
    try: canvas.drawImage(LOGO, 12*mm, h-16*mm, width=12*mm, height=10*mm, preserveAspectRatio=True, mask='auto')
    except Exception: pass
    canvas.setFillColor(colors.white); canvas.setFont("Helvetica-Bold", 12); canvas.drawString(27*mm, h-11.5*mm, "AgroCore")
    canvas.setFont("Helvetica", 9); canvas.drawRightString(w-12*mm, h-11.5*mm, "Puesta en marcha - guía rápida")
    canvas.setFillColor(SLATE); canvas.setFont("Helvetica", 7)
    canvas.drawString(12*mm, 7*mm, "AgroCore - El corazón del negocio agrícola")
    canvas.drawRightString(w-12*mm, 7*mm, "Pegá esta hoja al lado de la compu")
    canvas.restoreState()

def build():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=12*mm, rightMargin=12*mm, topMargin=22*mm, bottomMargin=11*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = []
    E.append(Paragraph("Primeros pasos para dejar tu empresa lista", S("t", fontName="Helvetica-Bold", fontSize=15, textColor=G900, spaceAfter=1, leading=18)))
    E.append(Paragraph("Seguí el orden. No hace falta completar todo para empezar: lo mínimo es empresa, usuario, una caja o banco, y los campos.",
                       S("s", fontName="Helvetica", fontSize=8.6, textColor=SLATE, spaceAfter=5, leading=11)))

    # Aviso login
    av = Paragraph("<b>Para entrar:</b> usá el usuario que te entregamos (ej. <b>super@agrocore.local</b> / <b>super123</b>) "
                   "y cambiá la clave apenas ingreses (Configuración &gt; tu usuario).",
                   S("av", fontName="Helvetica", fontSize=8.4, textColor=AMBER_TX, leading=10.5))
    tav = Table([[av]], colWidths=[186*mm])
    tav.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),AMBER_BG),("BOX",(0,0),(-1,-1),1,AMBER_BD),
        ("LEFTPADDING",(0,0),(-1,-1),8),("RIGHTPADDING",(0,0),(-1,-1),8),("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5)]))
    E.append(tav); E.append(Spacer(1,6))

    # Grilla de pasos en 2 columnas
    def celda(i, paso):
        n, tit, desc, ruta = i, paso[0], paso[1], paso[2]
        num = Table([[Paragraph(str(n), st_num)]], colWidths=[6.5*mm], rowHeights=[6.5*mm])
        num.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),G600),("VALIGN",(0,0),(-1,-1),"MIDDLE"),
            ("LEFTPADDING",(0,0),(-1,-1),0),("RIGHTPADDING",(0,0),(-1,-1),0),
            ("TOPPADDING",(0,0),(-1,-1),0),("BOTTOMPADDING",(0,0),(-1,-1),0),("ROUNDEDCORNERS",[2,2,2,2])]))
        cont = [Paragraph(tit, st_tit), Paragraph(desc, st_desc), Paragraph(ruta, st_ruta)]
        inner = Table([[num, cont]], colWidths=[8*mm, 82*mm])
        inner.setStyle(TableStyle([("VALIGN",(0,0),(0,0),"TOP"),("VALIGN",(1,0),(1,0),"TOP"),
            ("LEFTPADDING",(0,0),(-1,-1),0),("RIGHTPADDING",(0,0),(-1,-1),2),
            ("TOPPADDING",(0,0),(-1,-1),0),("BOTTOMPADDING",(0,0),(-1,-1),0)]))
        return inner

    rows = []
    for k in range(0, len(PASOS), 2):
        left = celda(k+1, PASOS[k])
        right = celda(k+2, PASOS[k+1]) if k+1 < len(PASOS) else Paragraph("", st_desc)
        rows.append([left, right])
    grid = Table(rows, colWidths=[93*mm, 93*mm])
    grid.setStyle(TableStyle([
        ("VALIGN",(0,0),(-1,-1),"TOP"),
        ("LEFTPADDING",(0,0),(-1,-1),2),("RIGHTPADDING",(0,0),(-1,-1),2),
        ("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5),
        ("LINEBELOW",(0,0),(-1,-2),0.4,G100),
    ]))
    E.append(grid)

    E.append(Spacer(1,4))
    E.append(Paragraph("Tip: cualquier duda, escribile al asistente (botón Mensajes) — te explica cómo se hace cada cosa, incluso te habla con voz.",
                       S("tip", fontName="Helvetica-Oblique", fontSize=8.2, textColor=G700, leading=10.5)))
    doc.build(E); print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
