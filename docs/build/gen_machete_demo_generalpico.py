# -*- coding: utf-8 -*-
"""Machete (1 carilla) para la demo de General Pico. Estilo AgroCore."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Machete-Demo-General-Pico.pdf")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
SLATE = colors.HexColor("#475569"); INK = colors.HexColor("#111827")

styles = getSampleStyleSheet()
def S(name, **kw):
    return ParagraphStyle(name, parent=styles["Normal"], **kw)

st_block = S("blk", fontName="Helvetica-Bold", fontSize=9.5, textColor=G900, leading=11, spaceBefore=1, spaceAfter=1)
st_do    = S("do",  fontName="Helvetica", fontSize=8.2, textColor=INK, leading=10)
st_say   = S("say", fontName="Helvetica-Oblique", fontSize=8.2, textColor=BLUE_TX, leading=10)
st_obq   = S("obq", fontName="Helvetica-Bold", fontSize=8, textColor=G900, leading=9.5)
st_oba   = S("oba", fontName="Helvetica", fontSize=8, textColor=INK, leading=9.5)
st_hd    = S("hd", fontName="Helvetica-Bold", fontSize=8.6, textColor=colors.white, leading=10)

def block(num, title, dos, sayt):
    inner = [Paragraph("%s &nbsp; %s" % (num, title), st_block)]
    inner.append(Paragraph("&#9654; " + dos, st_do))
    inner.append(Paragraph("&#128172; " + sayt, st_say))
    t = Table([[x] for x in inner], colWidths=[86*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,-1),colors.HexColor("#f8faf8")),
        ("LINEBEFORE",(0,0),(0,-1),2.2,G600),
        ("LEFTPADDING",(0,0),(-1,-1),6),("RIGHTPADDING",(0,0),(-1,-1),5),
        ("TOPPADDING",(0,0),(-1,-1),2),("BOTTOMPADDING",(0,0),(-1,-1),3),
    ]))
    return t

def header_footer(canvas, doc):
    canvas.saveState(); w,h = A4
    canvas.setFillColor(G900); canvas.rect(0, h-16*mm, w, 16*mm, fill=1, stroke=0)
    try:
        canvas.drawImage(LOGO, 12*mm, h-14*mm, width=11*mm, height=9.4*mm,
                         preserveAspectRatio=True, mask='auto')
    except Exception: pass
    canvas.setFillColor(colors.white); canvas.setFont("Helvetica-Bold", 12)
    canvas.drawString(26*mm, h-10.5*mm, "AgroCore  -  Machete de demo")
    canvas.setFont("Helvetica", 8.5)
    canvas.drawRightString(w-12*mm, h-10.5*mm, "General Pico (La Pampa)")
    canvas.setFillColor(SLATE); canvas.setFont("Helvetica", 7)
    canvas.drawString(12*mm, 7*mm, "Orden: primero FINANZAS (su dolor), despues ganaderia. Cierre: prueba gratis 30 dias - agrocore.ar/prueba")
    canvas.restoreState()

def build():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=11*mm, rightMargin=11*mm,
                          topMargin=19*mm, bottomMargin=10*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='m', frames=[frame], onPage=header_footer)])
    E=[]

    # Banda diferencial
    hdr = Paragraph("META: que se vaya diciendo &ldquo;es el UNICO que me hace la ganaderia Y las finanzas en el mismo sistema&rdquo;", st_hd)
    tb = Table([[hdr]], colWidths=[188*mm])
    tb.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),G700),
        ("LEFTPADDING",(0,0),(-1,-1),8),("RIGHTPADDING",(0,0),(-1,-1),8),
        ("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4)]))
    E.append(tb); E.append(Spacer(1,4))

    left = [
        block("1", "GANCHO (2 min)",
              "Menu completo de un vistazo: ganaderia + finanzas juntas. Mostra selector de EMPRESA (multiempresa).",
              "&ldquo;Todo lo de un sistema ganadero, mas la parte financiera integrada. No necesitas un segundo programa.&rdquo;"),
        block("2A", "CONCILIACION BANCARIA",
              "Bancos > abrir cuenta > Importar resumen (PDF/foto). Verifica cuenta (verde) > importa > Conciliacion: cuenta+mes, machear, cerrar mes.",
              "&ldquo;Subis el PDF del banco, se concilia y al cerrar el mes queda bloqueado.&rdquo;"),
        block("2B", "CHEQUES (propios y terceros)",
              "Cheques: propios/terceros + filtros. Estados: cartera > depositado > cobrado / rechazado. Depositar, endosar o transferir. Aviso en calendario + export PDF.",
              "&ldquo;La cartera al dia: que tenes, cuando vence y en que estado. Chau Excel.&rdquo;"),
        block("2C", "FLUJO DE CAJA / FONDOS",
              "Flujo de fondos: detalle cronologico por empresa. Trae cheques, cuotas, arrendamientos y ctas a cobrar/pagar PROYECTADAS. Filtro fecha + Excel. Balance general.",
              "&ldquo;La pelicula completa de la plata: lo que paso y lo que viene. Por empresa o todo junto.&rdquo;"),
    ]
    right = [
        block("3", "GANADERIA (para el hermano)",
              "Rodeos y hacienda: stock por categoria/campo + movimientos. Costo por kilo. Guias DT-e (foto/PDF). Liquidaciones hacienda por PDF.",
              "&ldquo;Tan completo como los que ya vieron... pero mira que pasa cuando vende un lote.&rdquo;"),
        block("4", "PUENTE = EL ARGUMENTO",
              "EN VIVO: cobra una venta de hacienda ya cargada. Mostra que aparece SOLA en cuenta a cobrar > banco > flujo de caja > cartera de cheques.",
              "&ldquo;Un dato cargado UNA vez aparece en el banco, el cheque y el flujo. Por eso no necesitas dos sistemas.&rdquo;"),
        block("5", "MULTIEMPRESA + PERMISOS",
              "Selector de empresa (cada sociedad separada + resumen que suma). Usuarios y roles: vos=finanzas, hermano=ganaderia.",
              "&ldquo;Vos ves las finanzas, tu hermano el campo. Cada uno lo suyo, datos cruzados solos.&rdquo;"),
        block("6", "CIERRE (5 min)",
              "3 diferenciales: finanzas+ganaderia juntas / multiempresa con permisos / importa de PDF-foto. Prueba 30 dias con SUS datos. Agendar 2da llamada.",
              "&ldquo;Te dejo 30 dias gratis. Metele tu resumen y algo de hacienda y lo ves con tus numeros.&rdquo;"),
    ]
    cols = Table([[Table([[b] for b in left], colWidths=[92*mm]),
                   Table([[b] for b in right], colWidths=[92*mm])]],
                 colWidths=[94*mm,94*mm])
    cols.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"),
        ("LEFTPADDING",(0,0),(-1,-1),0),("RIGHTPADDING",(0,0),(-1,-1),2),
        ("TOPPADDING",(0,0),(-1,-1),0),("BOTTOMPADDING",(0,0),(-1,-1),0)]))
    E.append(cols)
    E.append(Spacer(1,5))

    # Objeciones (2 columnas dentro de un box ambar)
    obj = [
        ("Ya vi ganaderos completos", "La ganaderia esta a la altura; el plus es banco+cheques+flujo en el mismo lugar. No pagas ni aprendes 2 sistemas."),
        ("Lo contable lo ve mi contador", "Hub de exportacion (Libro IVA, retenciones). Vos el dia a dia; el contador recibe todo ordenado."),
        ("Es complicado migrar", "Importa de PDF/foto: banco, guias, liquidaciones. Te acompaniamos en la puesta en marcha."),
        ("Cuanto sale?", "Primero probalo 30 dias gratis con tus datos. El valor se ve solo cuando reemplaza 2 sistemas."),
        ("Y si se cae internet?", "Oficina, campo y celular; y hay opcion de servidor propio con backups."),
    ]
    rows=[[Paragraph("OBJECIONES -> RESPUESTA RAPIDA", S("o",fontName="Helvetica-Bold",fontSize=8.6,textColor=AMBER_TX,leading=10))]]
    for q,a in obj:
        rows.append([Paragraph("<b>%s:</b> %s" % (q,a), st_oba)])
    ob=Table(rows, colWidths=[188*mm])
    ob.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),AMBER_BG),("BOX",(0,0),(-1,-1),1,AMBER_BD),
        ("LEFTPADDING",(0,0),(-1,-1),8),("RIGHTPADDING",(0,0),(-1,-1),8),
        ("TOPPADDING",(0,0),(-1,-1),2.5),("BOTTOMPADDING",(0,0),(-1,-1),2.5),
        ("LINEBELOW",(0,0),(0,0),0.5,AMBER_BD)]))
    E.append(ob); E.append(Spacer(1,5))

    close=Paragraph("CIERRE: &ldquo;No te vendo un sistema ganadero mas. Te doy el UNICO que te ordena la hacienda Y la plata "
                    "en el mismo lugar: vos las finanzas, tu hermano el campo, y todo conversando solo.&rdquo;",
                    S("cl",fontName="Helvetica-Bold",fontSize=9,textColor=G900,leading=11))
    cb=Table([[close]], colWidths=[188*mm])
    cb.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),G100),("BOX",(0,0),(-1,-1),1.2,G600),
        ("LEFTPADDING",(0,0),(-1,-1),8),("RIGHTPADDING",(0,0),(-1,-1),8),
        ("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5)]))
    E.append(cb)

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
